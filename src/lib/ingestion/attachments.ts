// Drizzle-backed CRUD helpers for the `session_attachments` table.
//
// Kept thin — each helper is one Drizzle query plus a narrowed return.
// The API routes own validation / auth / storage orchestration; this
// module's job is to make state transitions atomic and typable.
//
// State-machine discipline: the `status` column is never set to an
// arbitrary string. All transitions go through named functions
// (`setExtracted`, `setExtractionError`, `markCommitted`, `discard`)
// so the valid edges are visible at the call site + greppable.
//
// Cross-tenant safety: every read/write filters by `companyId` or by
// `id` (which was minted inside an auth-gated route). There is no
// "fetch by id, trust the caller" helper. This mirrors the defence-
// in-depth pattern used by the scaffolding repo — RLS at the DB is
// the outer gate, application-level scoping is the inner gate.
//
// Why Drizzle + service-role connection and NOT the auth-scoped
// Supabase client: the API routes do their own auth check via
// `requireAuth` + session ownership lookup before calling in here, so
// the helpers can safely use the `postgres` superuser connection that
// bypasses RLS. Same pattern as `src/lib/brain/queries.ts`.

import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { sessionAttachments, sessions } from '@/db/schema';

import type {
  AttachmentKind,
  AttachmentRow,
  AttachmentStatus,
} from './types';

// ---- Types ----------------------------------------------------------------

/**
 * Inputs to `createAttachment`. All fields except `sessionId`,
 * `companyId`, and `kind` are optional because pasted-text attachments
 * skip storage entirely (no `storageKey`, no `mimeType`).
 *
 * `extractedText` is accepted here so pasted-text attachments can
 * land directly in the `extracted` state without a second UPDATE.
 * File attachments set it to `null` and rely on `setExtracted` after
 * the extractor runs.
 */
export interface CreateAttachmentInput {
  /**
   * Optional explicit id. When provided, the insert uses it instead of
   * `gen_random_uuid()` so Storage paths minted BEFORE the row exists
   * still resolve to the same attachment. The API route uses this so
   * the `attachments/{company}/{session}/{attachmentId}` object key
   * and the `session_attachments.id` row stay in sync.
   */
  id?: string;
  sessionId: string;
  companyId: string;
  kind: AttachmentKind;
  storageKey?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | bigint | null;
  extractedText?: string | null;
  status?: AttachmentStatus;
}

// ---- Helpers --------------------------------------------------------------

/**
 * Convert the DB row's `sizeBytes` (bigint — postgres-js mode) into
 * the shape this module exports. Kept separate so the Drizzle-row
 * type doesn't leak into the attachment-row export contract.
 */
function rowToAttachment(row: typeof sessionAttachments.$inferSelect): AttachmentRow {
  return {
    id: row.id,
    sessionId: row.sessionId,
    companyId: row.companyId,
    kind: row.kind as AttachmentKind,
    storageKey: row.storageKey,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    extractedText: row.extractedText,
    extractionError: row.extractionError,
    status: row.status as AttachmentStatus,
    committedDocId: row.committedDocId,
    injectedAtTurn: row.injectedAtTurn,
    createdAt: row.createdAt,
  };
}

// ---- CRUD -----------------------------------------------------------------

/**
 * Insert a new `session_attachments` row. Defaults `status` to
 * `'uploaded'` (or `'extracted'` for pasted-text, since there's no
 * extraction step). The caller owns the session-ownership check —
 * this helper trusts the inputs.
 *
 * Returns the full row so the API route can echo the id + status
 * without a second SELECT.
 */
export async function createAttachment(
  input: CreateAttachmentInput,
): Promise<AttachmentRow> {
  // Default status depends on kind: pasted-text skips extraction;
  // file uploads start at 'uploaded' until the extractor runs.
  const defaultStatus: AttachmentStatus =
    input.kind === 'pasted-text' ? 'extracted' : 'uploaded';

  const [row] = await db
    .insert(sessionAttachments)
    .values({
      // Spread the optional id only when provided; otherwise Drizzle
      // picks up the column's default (gen_random_uuid()). Spreading
      // `undefined` explicitly would override the default with NULL.
      ...(input.id ? { id: input.id } : {}),
      sessionId: input.sessionId,
      companyId: input.companyId,
      kind: input.kind,
      storageKey: input.storageKey ?? null,
      filename: input.filename ?? null,
      mimeType: input.mimeType ?? null,
      sizeBytes:
        input.sizeBytes === null || input.sizeBytes === undefined
          ? null
          : BigInt(input.sizeBytes),
      extractedText: input.extractedText ?? null,
      extractionError: null,
      status: input.status ?? defaultStatus,
    })
    .returning();

  return rowToAttachment(row);
}

/**
 * Fetch an attachment by id, scoped to the caller's company. Returns
 * `null` when the row doesn't exist OR belongs to a different company
 * (opaque 404 — we don't leak existence across tenants).
 *
 * Company filtering is belt-and-braces: the API route already checks
 * session ownership before calling in here, and RLS covers the
 * auth-scoped client. But routes that use the service-role `db`
 * connection (all of them) bypass RLS, so we re-enforce here.
 */
export async function getAttachment(
  id: string,
  companyId: string,
): Promise<AttachmentRow | null> {
  const rows = await db
    .select()
    .from(sessionAttachments)
    .where(
      and(
        eq(sessionAttachments.id, id),
        eq(sessionAttachments.companyId, companyId),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? rowToAttachment(row) : null;
}

/**
 * List all attachments for a session. Company-scoped + ordered by
 * `created_at DESC` so the UI can render the chip list in
 * most-recent-first order without re-sorting. Returns `[]` when the
 * session has no attachments or doesn't belong to the company.
 *
 * Used by the chip-list UI (when polling for post-upload status
 * changes) and by the integration test harness to assert row state
 * after a POST.
 */
export async function listAttachmentsForSession(
  sessionId: string,
  companyId: string,
): Promise<AttachmentRow[]> {
  const rows = await db
    .select()
    .from(sessionAttachments)
    .where(
      and(
        eq(sessionAttachments.sessionId, sessionId),
        eq(sessionAttachments.companyId, companyId),
      ),
    )
    .orderBy(desc(sessionAttachments.createdAt));

  return rows.map(rowToAttachment);
}

/**
 * Transition a row to `status = 'extracted'` and populate
 * `extracted_text`. Clears any prior `extraction_error` — the state
 * machine treats re-extraction as an atomic replace.
 *
 * No-op if the row doesn't exist (the .update just returns 0 rows).
 * Callers that need a post-update read should call `getAttachment`
 * explicitly.
 */
export async function setExtracted(id: string, text: string): Promise<void> {
  await db
    .update(sessionAttachments)
    .set({
      extractedText: text,
      extractionError: null,
      status: 'extracted',
    })
    .where(eq(sessionAttachments.id, id));
}

/**
 * Record an extraction failure. Leaves `status = 'uploaded'` (the
 * UserPromptSubmit handler's notice path inspects the error field
 * rather than the status). Keeps `extracted_text` untouched so a
 * retry path could differentiate "never tried" from "tried and failed".
 */
export async function setExtractionError(
  id: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(sessionAttachments)
    .set({
      extractionError: errorMessage,
    })
    .where(eq(sessionAttachments.id, id));
}

/**
 * Transition an attachment to `status = 'committed'` and record the
 * brain doc id it was committed to. Called by the Brain CRUD routes
 * when a proposal referencing this attachment is approved.
 *
 * IMPORTANT: this is the ONLY write that transitions to `committed`.
 * The agent runtime never calls this — only HTTP handlers invoked by
 * the authenticated human user. The invariant is documented here so
 * future refactors don't accidentally invert it.
 */
export async function markCommitted(
  id: string,
  docId: string,
): Promise<void> {
  await db
    .update(sessionAttachments)
    .set({
      status: 'committed',
      committedDocId: docId,
    })
    .where(eq(sessionAttachments.id, id));
}

/**
 * Transition to `status = 'discarded'`. Storage file purge is
 * scheduled asynchronously by the nightly cron
 * (`src/app/api/cron/attachment-cleanup/route.ts`) — this helper
 * doesn't touch Storage directly. Discarded rows linger for 7 days
 * so the cron has time to pick them up; history also stays queryable
 * for audit until purge.
 */
export async function discard(id: string): Promise<void> {
  await db
    .update(sessionAttachments)
    .set({
      status: 'discarded',
    })
    .where(eq(sessionAttachments.id, id));
}

// ---- Session-ownership check --------------------------------------------
//
// Shared helper used by the API routes: before inserting an
// attachment, verify that the caller owns the target session. We do
// this with a single indexed lookup rather than reaching into the
// supabase-auth RLS path so the service-role connection in the route
// can still enforce the check.

/**
 * Return `{ sessionId, companyId }` iff the session belongs to the
 * given user. `null` on miss — the route returns 404 (not 403) to
 * avoid leaking session existence across users.
 */
export async function verifySessionOwnership(
  sessionId: string,
  userId: string,
): Promise<{ sessionId: string; companyId: string } | null> {
  const rows = await db
    .select({
      id: sessions.id,
      companyId: sessions.companyId,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { sessionId: row.id, companyId: row.companyId };
}

// ---- Query helpers -------------------------------------------------------

/**
 * Pull every `extracted` attachment for a session. Used by the Task 6
 * UserPromptSubmit repo to inline content into the next agent turn.
 *
 * Why this lives here (and is re-exported from `src/lib/context/
 * repos.ts`) rather than inline there: the Drizzle query mechanics
 * should stay next to the schema module that owns them. The repo
 * file then becomes a thin wiring layer — no DB detail leaks out of
 * the ingestion library.
 *
 * Company-scoped on purpose: explicit defence-in-depth that matches
 * the contract of the other read helpers in this module
 * (`getAttachment`, `listAttachmentsForSession`). The caller (the
 * DB-backed UserPromptRepo) already receives `companyId` in the
 * input context, so threading it through here is trivial — and it
 * means a bug upstream that leaks a `sessionId` across tenants still
 * can't pull attachments from the wrong company.
 *
 * Order: `created_at DESC` so the newest attachment inlines first
 * (the budget allocator in user-prompt.ts drops the oldest when the
 * budget runs out).
 */
export async function getExtractedAttachmentsForSession(
  companyId: string,
  sessionId: string,
): Promise<
  Array<{
    id: string;
    filename: string | null;
    extractedText: string;
    sizeBytes: number;
  }>
> {
  const rows = await db
    .select({
      id: sessionAttachments.id,
      filename: sessionAttachments.filename,
      extractedText: sessionAttachments.extractedText,
      sizeBytes: sessionAttachments.sizeBytes,
    })
    .from(sessionAttachments)
    .where(
      and(
        eq(sessionAttachments.companyId, companyId),
        eq(sessionAttachments.sessionId, sessionId),
        eq(sessionAttachments.status, 'extracted'),
        // Only rows with non-null extracted_text are injection-eligible.
        // Extraction failures stay at status='uploaded' with
        // extraction_error set, so this predicate is defence-in-depth
        // rather than load-bearing.
        sql`${sessionAttachments.extractedText} IS NOT NULL`,
      ),
    )
    .orderBy(desc(sessionAttachments.createdAt));

  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    // The `IS NOT NULL` predicate above guarantees this, but TS can't
    // see through SQL into a non-null narrowing. Coerce explicitly.
    extractedText: r.extractedText ?? '',
    // bigint → number. Attachments are capped at 10MB (plenty of
    // safety margin under MAX_SAFE_INTEGER) so the coercion is lossless.
    sizeBytes: r.sizeBytes === null ? 0 : Number(r.sizeBytes),
  }));
}

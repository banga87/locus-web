// Shared types for the Phase 1.5 ingestion pipeline.
//
// The vocabulary here mirrors the CHECK-constrained columns on the
// `session_attachments` table (migration 0007) — any change to the
// string literals here MUST land as a paired migration against the
// DB-side CHECK constraint, otherwise inserts silently start bouncing.
//
// Why re-export the kind/status types instead of depending directly on
// the Drizzle schema's aliases: keeping the ingestion library's public
// surface free of Drizzle imports means route handlers and UI components
// can depend on these types without pulling in the DB client. The
// schema module's types are the source of truth; we re-declare them
// structurally identical so a type-incompatible drift is caught at
// compile time (see the `satisfies` checks in `attachments.ts`).

/** Whether this attachment was a binary upload or a paste. */
export type AttachmentKind = 'file' | 'pasted-text';

/**
 * Lifecycle state — see `src/db/schema/session-attachments.ts` for the
 * full state-machine diagram.
 *
 *   uploaded  → file hit storage, row exists, extraction not attempted.
 *   extracted → extractor produced text (or populated `extraction_error`
 *               on failure). Agent turns can inline the content.
 *   committed → user approved a proposal referencing this attachment;
 *               `committed_doc_id` points at the brain doc that
 *               resulted. Writes are gated behind a human — see the
 *               Brain CRUD routes which call `markCommitted`.
 *   discarded → user dismissed. Storage purge queued for the 7-day cron.
 */
export type AttachmentStatus =
  | 'uploaded'
  | 'extracted'
  | 'committed'
  | 'discarded';

/**
 * Discriminated result from `extractByMime` + its per-format siblings.
 * The success variant carries the extracted plaintext plus its UTF-8
 * byte length so callers don't have to re-measure. The error variant
 * carries a short human-readable reason suitable for persisting to
 * `session_attachments.extraction_error`.
 *
 * Extraction is best-effort: a failure is NOT a hard error — the
 * ingestion pipeline still inserts the row (status stays at `uploaded`,
 * `extraction_error` is populated) so the UserPromptSubmit handler can
 * surface a one-line notice to the agent.
 */
export type ExtractResult =
  | { ok: true; text: string; sizeBytes: number }
  | { ok: false; error: string };

/**
 * MIME types the ingestion pipeline accepts. Mirrored by the API
 * route's whitelist and the extractor dispatch in `extractByMime`.
 *
 * Deliberately narrow. Images, audio, video, xlsx/pptx, CSV, and legacy
 * `.doc` are all deferred — MVP scope per the design spec §Ingestion
 * Flow. Adding a new mime means: (1) a new extractor, (2) the API
 * route whitelist, (3) the UI accept list, (4) a test fixture.
 */
export const SUPPORTED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const;

export type SupportedMime = (typeof SUPPORTED_MIMES)[number];

/** Upload size cap enforced at the API boundary. 10MB is the plan's. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Row shape callers see when reading attachments. Matches the Drizzle
 * `$inferSelect` result for `session_attachments`, but re-declared so
 * consumers don't have to import the Drizzle module. Kept in sync via
 * the `satisfies SessionAttachment` constraint in `attachments.ts`.
 */
export interface AttachmentRow {
  id: string;
  sessionId: string;
  companyId: string;
  kind: AttachmentKind;
  storageKey: string | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: bigint | null;
  extractedText: string | null;
  extractionError: string | null;
  status: AttachmentStatus;
  committedDocId: string | null;
  injectedAtTurn: number | null;
  createdAt: Date;
}

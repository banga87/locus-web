// GET /api/attachments/[id] — fetch attachment metadata (no content).
// DELETE /api/attachments/[id] — transition to 'discarded'.
//
// Why GET never returns `extractedText`: the content is injected into
// the next agent turn via the UserPromptSubmit handler. Exposing the
// full text to the client would be redundant (the client already has
// the original upload) and would widen the attack surface — a
// compromised client token could exfiltrate extracted text for every
// attachment in the company's sessions. The UI only needs status +
// filename + size to render chips.
//
// DELETE semantics: we flip status to 'discarded'. The actual storage
// file purge happens asynchronously via the nightly cron at
// `src/app/api/cron/attachment-cleanup/route.ts`. This lets us keep
// the DELETE handler fast + idempotent — a re-delete is a no-op.
//
// 404 for cross-company lookups: `getAttachment` filters by companyId,
// so a miss includes "exists but in a different tenant". Returning 404
// (not 403) hides existence across tenants.

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { error, success } from '@/lib/api/response';
import {
  discard,
  getAttachment,
  verifySessionOwnership,
} from '@/lib/ingestion/attachments';

export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteCtx): Promise<Response> {
  try {
    const ctx = await requireAuth();
    if (!ctx.companyId) {
      return error('no_company', 'Complete setup first.', 403);
    }

    const { id } = await params;
    const row = await getAttachment(id, ctx.companyId);
    if (!row) {
      return error('not_found', 'Attachment not found.', 404);
    }

    // Extra session-ownership gate: even within the same company,
    // attachments are scoped to the uploading user. Mirror the
    // `session_attachments` RLS spelt out in migration 0009.
    const ownership = await verifySessionOwnership(row.sessionId, ctx.userId);
    if (!ownership) {
      return error('not_found', 'Attachment not found.', 404);
    }

    return success({
      id: row.id,
      sessionId: row.sessionId,
      filename: row.filename,
      mimeType: row.mimeType,
      // bigint is not JSON-serialisable; coerce to number. Upload cap
      // of 10MB keeps us well inside MAX_SAFE_INTEGER.
      sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
      status: row.status,
      extractionError: row.extractionError,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return error(e.code, e.message, e.statusCode);
    }
    console.error('[api/attachments/[id] GET] unhandled error:', e);
    return error('internal_error', 'An unexpected error occurred.', 500);
  }
}

export async function DELETE(
  _req: Request,
  { params }: RouteCtx,
): Promise<Response> {
  try {
    const ctx = await requireAuth();
    if (!ctx.companyId) {
      return error('no_company', 'Complete setup first.', 403);
    }

    const { id } = await params;
    const row = await getAttachment(id, ctx.companyId);
    if (!row) {
      return error('not_found', 'Attachment not found.', 404);
    }

    const ownership = await verifySessionOwnership(row.sessionId, ctx.userId);
    if (!ownership) {
      return error('not_found', 'Attachment not found.', 404);
    }

    // Idempotent: a re-delete on an already-discarded row is a no-op
    // at the DB level (UPDATE sets the same value). No special-case
    // needed; just flip status.
    await discard(id);

    return success({ id, status: 'discarded' });
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return error(e.code, e.message, e.statusCode);
    }
    console.error('[api/attachments/[id] DELETE] unhandled error:', e);
    return error('internal_error', 'An unexpected error occurred.', 500);
  }
}

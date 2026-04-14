// POST /api/attachments — upload a file or create a pasted-text attachment.
//
// Two body shapes, discriminated on Content-Type:
//   1. `multipart/form-data` — `file` (binary) + `sessionId` (uuid).
//      The standard "paperclip upload" path.
//   2. `application/json`    — `{ kind: 'pasted-text', sessionId, text }`.
//      The "big paste" path.
//
// Flow:
//   - Auth: caller must be the session owner (sessions.user_id = auth.uid()).
//     We check this application-side via `verifySessionOwnership` because
//     the service-role DB client used for writes bypasses RLS.
//   - Validation: file size ≤ 10MB, mime in SUPPORTED_MIMES.
//   - Mint an attachment id up-front (crypto.randomUUID) so the storage
//     path can use it before the row exists.
//   - Upload the binary to Supabase Storage under the canonical path
//     `attachments/{companyId}/{sessionId}/{attachmentId}`.
//   - Insert the row with status='uploaded'.
//   - Extract synchronously (sync for the whole 10MB range — a Vercel
//     function's default 30s timeout covers this comfortably). Transition
//     to 'extracted' on success, set extraction_error on failure.
//
// Why synchronous extraction for the whole size range (not the plan's
// ≤2MB / waitUntil split): `@vercel/functions.waitUntil` is available
// but keeping the route simple for MVP matches the plan's fallback note.
// Revisit if 10MB PDFs regularly blow through the 30s budget.
//
// Response: `{ id, status, extractionError? }`. The client uses this to
// render the chip state; the full extracted_text is never returned
// (injection is server-side only).

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { error, success } from '@/lib/api/response';
import { createClient } from '@/lib/supabase/server';
import {
  createAttachment,
  setExtracted,
  setExtractionError,
  verifySessionOwnership,
} from '@/lib/ingestion/attachments';
import { extractByMime } from '@/lib/ingestion/extractors';
import {
  MAX_UPLOAD_BYTES,
  SUPPORTED_MIMES,
  type SupportedMime,
} from '@/lib/ingestion/types';

export const runtime = 'nodejs';
// Extraction for large PDFs can take several seconds; bump from the
// default 10s to give headroom for a fully-saturated 10MB PDF under
// an unloaded cold-start.
export const maxDuration = 60;

// ---- Validation schemas ---------------------------------------------------

const pastedTextSchema = z.object({
  kind: z.literal('pasted-text'),
  sessionId: z.string().uuid(),
  text: z.string().min(1).max(1_000_000), // 1MB ceiling for pasted text.
  filename: z.string().max(500).optional(),
});

// ---- Handler --------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireAuth();
    if (!ctx.companyId) {
      return error('no_company', 'Complete setup first.', 403);
    }

    const contentType = req.headers.get('content-type') ?? '';

    // Route by content-type. Multipart = file upload; JSON = pasted-text.
    if (contentType.startsWith('multipart/form-data')) {
      return handleFileUpload(req, ctx.userId, ctx.companyId);
    }
    if (contentType.startsWith('application/json')) {
      return handlePastedText(req, ctx.userId, ctx.companyId);
    }
    return error(
      'unsupported_content_type',
      'Content-Type must be multipart/form-data or application/json.',
      415,
    );
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return error(e.code, e.message, e.statusCode);
    }
    console.error('[api/attachments POST] unhandled error:', e);
    return error('internal_error', 'An unexpected error occurred.', 500);
  }
}

// ---- File upload ---------------------------------------------------------

async function handleFileUpload(
  req: Request,
  userId: string,
  companyId: string,
): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return error('invalid_form', 'Malformed multipart body.', 400);
  }

  const file = form.get('file');
  const sessionIdRaw = form.get('sessionId');

  if (!(file instanceof Blob)) {
    return error('missing_file', 'Field `file` is required and must be a file.', 400);
  }
  if (typeof sessionIdRaw !== 'string') {
    return error('missing_session', 'Field `sessionId` is required.', 400);
  }

  // UUID sanity-check before hitting the DB.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionIdRaw)) {
    return error('invalid_session_id', 'sessionId must be a uuid.', 400);
  }

  // Validate session ownership. Returns null on miss (no leak).
  const ownership = await verifySessionOwnership(sessionIdRaw, userId);
  if (!ownership) {
    return error('session_not_found', 'Session not found.', 404);
  }
  if (ownership.companyId !== companyId) {
    // Defence-in-depth: user's company and session's company must match.
    // This SHOULD be impossible (RLS + session creation flow enforce it)
    // but we check anyway since we're using the service-role client.
    return error('session_company_mismatch', 'Session belongs to a different company.', 403);
  }

  // Size cap — 413 Payload Too Large is the standard error.
  if (file.size > MAX_UPLOAD_BYTES) {
    return error(
      'file_too_large',
      `File exceeds the ${MAX_UPLOAD_BYTES} byte limit.`,
      413,
    );
  }

  // MIME whitelist. `file.type` is the browser-supplied mime; enforce
  // it against SUPPORTED_MIMES so unknown formats don't slip through.
  const mime = file.type;
  if (!isSupportedMime(mime)) {
    return error(
      'unsupported_mime',
      `Unsupported content type: ${mime || 'unknown'}. ` +
        `Supported: ${SUPPORTED_MIMES.join(', ')}.`,
      415,
    );
  }

  // Filename — `Blob` doesn't carry a name; `File` (a Blob subclass) does.
  // The server-side File constructor includes `.name`.
  const filename = (file as File).name ?? 'upload';

  // Mint the attachment id up front so the storage key can reference
  // it. The DB row is inserted AFTER the storage put so a failed put
  // doesn't leave a dangling row.
  const attachmentId = randomUUID();
  const storageKey = `attachments/${companyId}/${ownership.sessionId}/${attachmentId}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  // Upload to Storage first. If this fails, we haven't polluted the DB.
  const supabase = await createClient();
  const { error: storageError } = await supabase.storage
    .from('attachments')
    .upload(storageKey, buffer, {
      contentType: mime,
      upsert: false,
    });

  if (storageError) {
    console.error('[api/attachments] storage upload failed', storageError);
    return error(
      'storage_upload_failed',
      `Upload failed: ${storageError.message}`,
      500,
    );
  }

  // Insert the row with the id we minted above, so the DB id and the
  // storage key's attachment segment match. Status starts at 'uploaded'.
  const row = await createAttachment({
    id: attachmentId,
    sessionId: ownership.sessionId,
    companyId,
    kind: 'file',
    storageKey,
    filename,
    mimeType: mime,
    sizeBytes: buffer.length,
  });
  const id = row.id;

  // Extract synchronously. Best-effort: failures populate
  // extraction_error instead of rejecting the whole upload.
  const extractResult = await extractByMime(mime, buffer);
  if (extractResult.ok) {
    await setExtracted(id, extractResult.text);
    return success({ id, status: 'extracted' });
  }

  await setExtractionError(id, extractResult.error);
  return success({
    id,
    status: 'uploaded',
    extractionError: extractResult.error,
  });
}

// ---- Pasted text ---------------------------------------------------------

async function handlePastedText(
  req: Request,
  userId: string,
  companyId: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid_json', 'Body must be valid JSON.', 400);
  }

  const parsed = pastedTextSchema.safeParse(body);
  if (!parsed.success) {
    return error('invalid_body', 'Invalid pasted-text body.', 400, parsed.error.issues);
  }
  const { sessionId, text, filename } = parsed.data;

  const ownership = await verifySessionOwnership(sessionId, userId);
  if (!ownership) {
    return error('session_not_found', 'Session not found.', 404);
  }
  if (ownership.companyId !== companyId) {
    return error('session_company_mismatch', 'Session belongs to a different company.', 403);
  }

  const sizeBytes = Buffer.byteLength(text, 'utf8');
  // Pasted-text attachments land directly in 'extracted' because
  // there's no extraction step — what the user pasted IS the text.
  const row = await createAttachment({
    sessionId: ownership.sessionId,
    companyId,
    kind: 'pasted-text',
    filename: filename ?? null,
    mimeType: 'text/plain',
    sizeBytes,
    extractedText: text,
    status: 'extracted',
  });

  return success({ id: row.id, status: 'extracted' });
}

// ---- Utilities -----------------------------------------------------------

function isSupportedMime(mime: string): mime is SupportedMime {
  return (SUPPORTED_MIMES as readonly string[]).includes(mime);
}

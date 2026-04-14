// Server-side text extractors for the Phase 1.5 ingestion pipeline.
//
// Three binary formats + one dispatch wrapper:
//   - PDF  → `unpdf` (lightweight pdf.js wrapper, no OCR).
//   - DOCX → `mammoth` (raw text, strips formatting).
//   - TXT/MD → direct UTF-8 decode.
//   - anything else → `{ ok: false, error: 'unsupported mime: …' }`.
//
// Contract:
//   - Never throws. Parse failures return `{ ok: false, error }` so
//     the API route can persist the error into `extraction_error`
//     without wrapping everything in try/catch.
//   - `sizeBytes` on the success variant is the UTF-8 byte length of
//     the extracted text, NOT the input buffer's length. This is the
//     number `session_attachments.size_bytes` records after extraction
//     (the original binary size is captured pre-extract, from the
//     multipart body; see `attachments.ts`). Keeping both lets the
//     UserPromptSubmit budget check act on the text size rather than
//     the disk footprint.
//
// Node Promise.try polyfill — see below. The module's top-level guard
// hardens us against a Node-version quirk where `unpdf`'s pdf.js
// bundle calls `Promise.try` but the host runtime is old enough
// (<22.11 ish) that the method isn't yet global. We detect on import
// and patch defensively; a no-op on modern runtimes.

import mammoth from 'mammoth';
import { extractText as unpdfExtractText } from 'unpdf';

import type { ExtractResult } from './types';

// ---- Promise.try polyfill -------------------------------------------------
//
// `unpdf` 1.x bundles a pdf.js variant that calls `Promise.try(fn,
// arg)` (note: two-argument form, where the second arg is passed
// through to `fn`). The method landed in V8 around 12.6; Node 22.18
// still ships V8 12.4 on some build platforms (Windows node-gyp in
// particular), so `Promise.try` is undefined there. A missing method
// surfaces as `TypeError: Promise.try is not a function` deep inside
// pdf.js's message handler — opaque and unrecoverable.
//
// We patch at module load time (idempotent + guarded so we never
// clobber a real implementation) AND defensively before each
// `extractPdf` call. The top-level patch is usually sufficient; the
// per-call patch exists because (a) test runners sometimes reset
// globals between tests and (b) the bundle's Promise.try call lives
// inside a class method that gets invoked asynchronously long after
// the initial module evaluation — so if any other code has clobbered
// the polyfill (unlikely but possible), we self-heal here. Zero-cost
// when the method is present.
function ensurePromiseTryPolyfill(): void {
  if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
    (
      Promise as unknown as {
        try: <T>(
          fn: (...args: unknown[]) => T | Promise<T>,
          ...args: unknown[]
        ) => Promise<T>;
      }
    ).try = <T,>(
      fn: (...args: unknown[]) => T | Promise<T>,
      ...args: unknown[]
    ): Promise<T> =>
      new Promise<T>((resolve) => resolve(fn(...args)));
  }
}
ensurePromiseTryPolyfill();

// ---- PDF ------------------------------------------------------------------

/**
 * Extract plain text from a PDF buffer. Merges page text with `\n`
 * separators — sufficient for context injection, which does not
 * reconstruct layout.
 *
 * Failure modes:
 *   - Corrupt / not-a-PDF buffer → `{ ok: false, error: <reason> }`.
 *   - Password-protected PDF → errors through pdf.js ("InvalidPDF…"
 *     etc.); treated the same as corrupt.
 *   - Zero-text PDF (image-only / scanned) → `{ ok: true, text: '' }`.
 *     The UserPromptSubmit handler surfaces empty text as a notice;
 *     callers don't need a separate branch.
 */
export async function extractPdf(buf: Buffer): Promise<ExtractResult> {
  // Re-apply the Promise.try polyfill defensively. See module header.
  ensurePromiseTryPolyfill();
  try {
    // `mergePages: true` returns a single string; `false` returns
    // `string[]`. We always merge because downstream consumers want
    // one block per attachment.
    const result = await unpdfExtractText(new Uint8Array(buf), {
      mergePages: true,
    });
    const text = Array.isArray(result.text) ? result.text.join('\n') : result.text;
    return {
      ok: true,
      text,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'pdf extract failed',
    };
  }
}

// ---- DOCX -----------------------------------------------------------------

/**
 * Extract plain text from a .docx buffer via `mammoth.extractRawText`.
 * This strips all formatting — headings, lists, emphasis — which is
 * exactly what we want for context injection. Mammoth also returns
 * structured warnings (`.messages`) that we ignore: at MVP scope the
 * agent doesn't need to know that a footnote was dropped.
 *
 * Failure modes:
 *   - Corrupt / not-a-zip buffer → mammoth throws; we map to `{ ok:
 *     false, error }`.
 *   - Legacy `.doc` (not `.docx`) → mammoth rejects; the API route's
 *     mime whitelist should have rejected earlier, but belt-and-braces.
 */
export async function extractDocx(buf: Buffer): Promise<ExtractResult> {
  // mammoth's async internals use standard Promise + async/await — no
  // Promise.try dependency, so we don't need the polyfill call that
  // extractPdf uses. Keep this in mind if mammoth is ever swapped for
  // a pdf.js-style parser.
  try {
    const result = await mammoth.extractRawText({ buffer: buf });
    return {
      ok: true,
      text: result.value,
      sizeBytes: Buffer.byteLength(result.value, 'utf8'),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'docx extract failed',
    };
  }
}

// ---- Plain text / markdown ------------------------------------------------

/**
 * Decode a plain-text or markdown buffer as UTF-8. Always succeeds —
 * invalid bytes get the replacement character U+FFFD rather than
 * throwing, which is how `Buffer.toString('utf8')` behaves by default.
 *
 * Why this is synchronous + async-returning anyway: keeps the
 * extractor signature uniform across formats (`Promise<ExtractResult>`)
 * so `extractByMime` can delegate without awaiting inside its switch.
 */
export async function extractPlainText(buf: Buffer): Promise<ExtractResult> {
  const text = buf.toString('utf8');
  return {
    ok: true,
    text,
    sizeBytes: Buffer.byteLength(text, 'utf8'),
  };
}

// ---- Dispatch -------------------------------------------------------------

/**
 * MIME-dispatched extraction. The API route calls this once per
 * upload; unsupported mimes return an error result (NOT a throw) so
 * callers can persist the reason into `extraction_error` uniformly.
 *
 * Recognised mimes mirror `SUPPORTED_MIMES` in `./types.ts`. Keep the
 * two in sync when adding a new format (test failure will remind you).
 */
export async function extractByMime(
  mime: string,
  buf: Buffer,
): Promise<ExtractResult> {
  if (mime === 'application/pdf') {
    return extractPdf(buf);
  }
  if (
    mime ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return extractDocx(buf);
  }
  if (mime === 'text/plain' || mime === 'text/markdown') {
    return extractPlainText(buf);
  }
  return { ok: false, error: `unsupported mime: ${mime}` };
}

/**
 * @vitest-environment node
 */
// Unit tests for the ingestion extractors.
//
// The `node` environment override matters: the default vitest env in
// this repo is jsdom (see vitest.config.ts), and `unpdf`'s runtime
// detection (`typeof window !== 'undefined'` → `isBrowser = true`)
// routes through a pdf.js code path that needs a real browser worker.
// Under jsdom the worker init fails with "Cannot destructure property
// 'docId' of 'e'", breaking every PDF assertion below. Flipping this
// file to the node environment is the minimal fix — no global polyfill
// gymnastics, no shared setup change for the rest of the test suite.
//
// Fixture files under `./__fixtures__/` are tiny (<2KB each). The PDF
// was hand-assembled as a PDF 1.4 byte stream with one Tj (text-show)
// operator in the content stream — small enough to skim in hex, which
// is what you want for a "did the extractor pipeline break?" smoke test.
// The DOCX is a JSZip-generated minimal package with one <w:t> run.
// The MD file is just utf-8 text.
//
// Keep the distinctive marker phrases (`hello-extractor-from-pdf`,
// `hello-extractor-from-docx`, `hello-extractor-from-md`) — each is
// unique per format, so when a test regression happens the failure
// message unambiguously points at the broken extractor.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  extractByMime,
  extractDocx,
  extractPdf,
  extractPlainText,
} from './extractors';

const FIXTURE_DIR = resolve(__dirname, '__fixtures__');

function loadFixture(name: string): Buffer {
  return readFileSync(resolve(FIXTURE_DIR, name));
}

// ---- PDF ------------------------------------------------------------------

describe('extractPdf', () => {
  it('extracts text from a valid PDF', async () => {
    const buf = loadFixture('sample.pdf');
    const result = await extractPdf(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('hello-extractor-from-pdf');
    // sizeBytes is the utf-8 length of extracted text, not the PDF
    // file size. Assert it looks plausible (less than the raw buffer).
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.sizeBytes).toBeLessThan(buf.length);
  });

  it('returns an error result for corrupt PDF bytes', async () => {
    const garbage = Buffer.from('this is definitely not a PDF');
    const result = await extractPdf(garbage);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Don't pin the exact message — pdf.js wording varies across
    // versions. Just assert the failure surface is a non-empty string.
    expect(typeof result.error).toBe('string');
    expect(result.error.length).toBeGreaterThan(0);
  });
});

// ---- DOCX -----------------------------------------------------------------

describe('extractDocx', () => {
  it('extracts text from a valid DOCX', async () => {
    const buf = loadFixture('sample.docx');
    const result = await extractDocx(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('hello-extractor-from-docx');
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it('returns an error result for non-zip bytes', async () => {
    const garbage = Buffer.from('not a docx zip either');
    const result = await extractDocx(garbage);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });
});

// ---- Plain text -----------------------------------------------------------

describe('extractPlainText', () => {
  it('round-trips markdown content unchanged', async () => {
    const buf = loadFixture('sample.md');
    const result = await extractPlainText(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('hello-extractor-from-md');
    // The returned size matches what Buffer.byteLength reports on the
    // text — not the raw buffer. For ASCII-only markdown these match,
    // but we assert on the text-derived size so the guarantee is
    // explicit.
    expect(result.sizeBytes).toBe(Buffer.byteLength(result.text, 'utf8'));
  });

  it('handles UTF-8 multi-byte characters', async () => {
    const buf = Buffer.from('café — naïve résumé', 'utf8');
    const result = await extractPlainText(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('café — naïve résumé');
    // Two-byte chars inflate byte length above character count.
    expect(result.sizeBytes).toBeGreaterThan(result.text.length);
  });

  it('replaces invalid UTF-8 bytes with U+FFFD instead of throwing', async () => {
    // 0xFF is never valid as a UTF-8 starter byte.
    const buf = Buffer.from([0x48, 0x69, 0xff, 0x21]); // "Hi<invalid>!"
    const result = await extractPlainText(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Node replaces invalid bytes with U+FFFD; we just assert the
    // extractor didn't throw and produced something.
    expect(result.text).toContain('Hi');
    expect(result.text).toContain('!');
  });
});

// ---- Dispatch -------------------------------------------------------------

describe('extractByMime', () => {
  it('dispatches application/pdf to extractPdf', async () => {
    const buf = loadFixture('sample.pdf');
    const result = await extractByMime('application/pdf', buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('hello-extractor-from-pdf');
  });

  it('dispatches DOCX mime to extractDocx', async () => {
    const buf = loadFixture('sample.docx');
    const result = await extractByMime(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buf,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('hello-extractor-from-docx');
  });

  it('dispatches text/plain to extractPlainText', async () => {
    const buf = Buffer.from('plain text marker xyz', 'utf8');
    const result = await extractByMime('text/plain', buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('plain text marker xyz');
  });

  it('dispatches text/markdown to extractPlainText', async () => {
    const buf = loadFixture('sample.md');
    const result = await extractByMime('text/markdown', buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('hello-extractor-from-md');
  });

  it('returns an error for unsupported mimes', async () => {
    const result = await extractByMime('image/png', Buffer.from([0x89, 0x50]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unsupported mime');
    expect(result.error).toContain('image/png');
  });

  it('returns an error for mime types we could have supported but did not (e.g., xlsx)', async () => {
    // Guarding against a future regression where someone adds xlsx
    // support without updating the SUPPORTED_MIMES list.
    const result = await extractByMime(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      Buffer.from('nope'),
    );
    expect(result.ok).toBe(false);
  });
});

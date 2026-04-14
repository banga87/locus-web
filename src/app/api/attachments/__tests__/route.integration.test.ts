/**
 * @vitest-environment node
 */
// Integration test for POST /api/attachments — the full upload path.
//
// Environment is pinned to `node` for the same reason extractors.test.ts
// overrides: unpdf needs the Node path to parse PDFs, and jsdom confuses
// its runtime detection.
//
// Scope: exercises the file-handler wing end-to-end by invoking the
// route's exported `POST` function with a hand-built Request carrying
// a multipart body. We stub Supabase Auth + Storage at the module
// boundary (the `@/lib/supabase/server` mock) so the test doesn't need
// a live user or a real Storage bucket. The Drizzle DB connection is
// left LIVE — we want to assert real row writes (status transitions,
// extracted_text population).
//
// Why not stub Drizzle too: the helpers under test compose Drizzle
// queries + state-machine invariants. Mocking the DB would pin the
// test to call shapes rather than behaviour, and the existing repo-
// integration tests already establish the real-DB pattern for this
// codebase. Borrowing it here keeps the test battery uniform.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import {
  brains,
  companies,
  sessionAttachments,
  sessions,
  users,
} from '@/db/schema';

// ---- Mocks ---------------------------------------------------------------
//
// `@/lib/supabase/server` owns the auth + storage client. We stub the
// whole module with a factory that returns a fake supabase client whose
// `.auth.getUser()` resolves to our seeded fixture user and whose
// `.storage.from('attachments').upload()` succeeds without touching a
// real bucket. This lets the route run unchanged against a real DB.

let mockedUserId: string | null = null;
// `recordedStorageUploads` captures every upload attempt the route
// makes, so assertions can verify the storage key format without
// hitting a real bucket.
const recordedStorageUploads: Array<{ key: string; contentType?: string }> = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: mockedUserId ? { id: mockedUserId, email: 'test@example.com' } : null,
        },
      }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (
          key: string,
          _body: unknown,
          opts: { contentType?: string } = {},
        ) => {
          expect(bucket).toBe('attachments');
          recordedStorageUploads.push({ key, contentType: opts.contentType });
          return { data: { path: key }, error: null };
        },
      }),
    },
  }),
}));

// Import the route AFTER the mock is registered. Top-level imports
// hoist to module load, so `vi.mock` + bare `import` alone would run
// in the wrong order. Dynamic import in beforeAll sidesteps this.
let POST: (req: Request) => Promise<Response>;

// ---- Fixture --------------------------------------------------------------

const suffix = `rt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let sessionId: string;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/attachments/route'));

  const [company] = await db
    .insert(companies)
    .values({ name: `Route Test Co ${suffix}`, slug: `rt-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Main', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  const mintedUserId = randomUUID();
  const [user] = await db
    .insert(users)
    .values({
      id: mintedUserId,
      email: `rt-${suffix}@example.com`,
      fullName: 'Route Test User',
      role: 'owner',
      status: 'active',
      companyId,
    })
    .returning({ id: users.id });
  userId = user.id;
  mockedUserId = userId;

  const [session] = await db
    .insert(sessions)
    .values({ companyId, brainId, userId, status: 'active' })
    .returning({ id: sessions.id });
  sessionId = session.id;
}, 60_000);

afterAll(async () => {
  await db
    .delete(sessionAttachments)
    .where(eq(sessionAttachments.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await db.delete(brains).where(eq(brains.id, brainId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(companies).where(eq(companies.id, companyId));
  mockedUserId = null;
}, 60_000);

// ---- Helpers --------------------------------------------------------------

function buildMultipartRequest(
  fileBuf: Buffer,
  filename: string,
  mimeType: string,
  sessionIdArg: string,
): Request {
  const form = new FormData();
  // Convert Buffer to Uint8Array — Blob's type signature wants
  // ArrayBufferView (over a real ArrayBuffer, not SharedArrayBuffer).
  // `new Uint8Array(buf)` on a Node Buffer creates a zero-copy view.
  const view = new Uint8Array(fileBuf);
  const blob = new Blob([view], { type: mimeType });
  // In the Node test environment, `File` is a global (undici) and
  // carries `.name`. Construct it explicitly so the route handler
  // sees the filename.
  const file = new File([blob], filename, { type: mimeType });
  form.set('file', file);
  form.set('sessionId', sessionIdArg);

  return new Request('http://localhost/api/attachments', {
    method: 'POST',
    body: form,
  });
}

function loadFixture(name: string): Buffer {
  return readFileSync(
    resolve(__dirname, '..', '..', '..', '..', 'lib', 'ingestion', '__fixtures__', name),
  );
}

// ---- Tests ----------------------------------------------------------------

describe('POST /api/attachments', () => {
  it('uploads a PDF, extracts text, and writes status=extracted', async () => {
    const before = recordedStorageUploads.length;
    const buf = loadFixture('sample.pdf');
    const req = buildMultipartRequest(
      buf,
      'sample.pdf',
      'application/pdf',
      sessionId,
    );

    const response = await POST(req);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      success: boolean;
      data: { id: string; status: string };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('extracted');
    expect(payload.data.id).toMatch(/^[0-9a-f-]{36}$/i);

    // Storage was called once with the canonical path shape.
    expect(recordedStorageUploads.length).toBe(before + 1);
    const lastUpload = recordedStorageUploads[before];
    expect(lastUpload.key).toBe(
      `attachments/${companyId}/${sessionId}/${payload.data.id}`,
    );
    expect(lastUpload.contentType).toBe('application/pdf');

    // DB row landed with extracted_text populated.
    const [row] = await db
      .select()
      .from(sessionAttachments)
      .where(eq(sessionAttachments.id, payload.data.id))
      .limit(1);
    expect(row).toBeDefined();
    expect(row.status).toBe('extracted');
    expect(row.extractedText).toContain('hello-extractor-from-pdf');
    expect(row.storageKey).toBe(lastUpload.key);
    expect(row.kind).toBe('file');
  });

  it('rejects uploads over the 10MB cap with 413', async () => {
    // Build a slightly-over-10MB buffer. Plain text so extraction
    // isn't even attempted — size check fires first.
    const buf = Buffer.alloc(10 * 1024 * 1024 + 1, 'a');
    const req = buildMultipartRequest(
      buf,
      'too-big.txt',
      'text/plain',
      sessionId,
    );

    const response = await POST(req);
    expect(response.status).toBe(413);

    const payload = (await response.json()) as {
      error: { code: string };
    };
    expect(payload.error.code).toBe('file_too_large');
  });

  it('rejects unsupported mimes with 415', async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
    const req = buildMultipartRequest(
      buf,
      'image.png',
      'image/png',
      sessionId,
    );

    const response = await POST(req);
    expect(response.status).toBe(415);

    const payload = (await response.json()) as {
      error: { code: string };
    };
    expect(payload.error.code).toBe('unsupported_mime');
  });

  it('returns 404 for a session the user does not own', async () => {
    const strangerSessionId = randomUUID();
    const buf = loadFixture('sample.md');
    const req = buildMultipartRequest(
      buf,
      'sample.md',
      'text/markdown',
      strangerSessionId,
    );

    const response = await POST(req);
    expect(response.status).toBe(404);

    const payload = (await response.json()) as {
      error: { code: string };
    };
    expect(payload.error.code).toBe('session_not_found');
  });

  it('handles pasted-text JSON body', async () => {
    const body = {
      kind: 'pasted-text',
      sessionId,
      text: 'pasted content with marker xyz',
      filename: 'pasted.md',
    };
    const req = new Request('http://localhost/api/attachments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      success: boolean;
      data: { id: string; status: string };
    };
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('extracted');

    const [row] = await db
      .select()
      .from(sessionAttachments)
      .where(eq(sessionAttachments.id, payload.data.id))
      .limit(1);
    expect(row.kind).toBe('pasted-text');
    expect(row.storageKey).toBeNull();
    expect(row.extractedText).toBe('pasted content with marker xyz');
    expect(row.filename).toBe('pasted.md');
  });
});

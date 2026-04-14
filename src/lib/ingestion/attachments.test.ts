// Integration tests for the session_attachments CRUD helpers.
//
// Runs against live Supabase via the Drizzle superuser connection
// (DATABASE_URL — bypasses RLS so we can seed + read without the
// Supabase Auth dance). Mirrors the fixture pattern in
// `src/lib/context/scaffolding.integration.test.ts` — create a fresh
// company + brain + user + session in beforeAll, tear down in afterAll.
//
// Why integration vs. pure unit: every helper is a single Drizzle query
// with a narrowed return. Mocking `db` would pin the test to the query
// shape rather than the behaviour we care about ("writing 'extracted'
// to the status column lands"). The integration variant catches schema
// drift, CHECK-constraint violations, and RLS-vs-service-role mistakes
// that a mocked test would paper over.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import {
  brains,
  categories,
  companies,
  documents,
  sessionAttachments,
  sessions,
  users,
} from '@/db/schema';

import {
  createAttachment,
  discard,
  getAttachment,
  getExtractedAttachmentsForSession,
  listAttachmentsForSession,
  markCommitted,
  setExtracted,
  setExtractionError,
  verifySessionOwnership,
} from './attachments';

// ---- Fixture --------------------------------------------------------------

const suffix = `atta-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let categoryId: string;
let userId: string;
let sessionId: string;
let otherSessionId: string;
let otherCompanyId: string;

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `Attachment Test Co ${suffix}`, slug: `atta-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const [otherCompany] = await db
    .insert(companies)
    .values({
      name: `Other Co ${suffix}`,
      slug: `atta-other-${suffix}`,
    })
    .returning({ id: companies.id });
  otherCompanyId = otherCompany.id;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Main', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  const [category] = await db
    .insert(categories)
    .values({
      companyId,
      brainId,
      slug: `atta-cat-${suffix}`,
      name: 'Attachment fixtures',
    })
    .returning({ id: categories.id });
  categoryId = category.id;

  // The `users` table mirrors Supabase Auth's `auth.users.id`, so no
  // default-random. Mint a UUID ourselves — the Auth row doesn't exist
  // but sessions.user_id only needs the public.users FK to satisfy.
  const mintedUserId = randomUUID();
  const [user] = await db
    .insert(users)
    .values({
      id: mintedUserId,
      email: `att-${suffix}@example.com`,
      fullName: 'Attachment Test User',
      role: 'owner',
      status: 'active',
      companyId,
    })
    .returning({ id: users.id });
  userId = user.id;

  const [session] = await db
    .insert(sessions)
    .values({
      companyId,
      brainId,
      userId,
      status: 'active',
    })
    .returning({ id: sessions.id });
  sessionId = session.id;

  // A second session for cross-session isolation checks. Belongs to
  // the SAME user + company so RLS won't interfere — we're testing the
  // application-level scoping in getAttachment / listAttachments.
  const [otherSession] = await db
    .insert(sessions)
    .values({
      companyId,
      brainId,
      userId,
      status: 'active',
    })
    .returning({ id: sessions.id });
  otherSessionId = otherSession.id;
}, 60_000);

afterAll(async () => {
  // Teardown order matters. `sessions.brain_id` has NO onDelete cascade
  // (there's an RLS surface deliberately scoped to session owner), so
  // dropping the brain would violate the FK. We walk the graph in
  // leaf-first order:
  //   session_attachments → sessions → brains → (companies cascade)
  // companies cascade the remaining categories + documents.
  await db.delete(sessionAttachments).where(eq(sessionAttachments.sessionId, sessionId));
  await db.delete(sessionAttachments).where(eq(sessionAttachments.sessionId, otherSessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await db.delete(sessions).where(eq(sessions.id, otherSessionId));
  await db.delete(brains).where(eq(brains.id, brainId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(companies).where(eq(companies.id, companyId));
  await db.delete(companies).where(eq(companies.id, otherCompanyId));
}, 60_000);

// ---- createAttachment -----------------------------------------------------

describe('createAttachment', () => {
  it('inserts a file attachment with status=uploaded by default', async () => {
    const row = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      storageKey: `attachments/${companyId}/${sessionId}/test-1.pdf`,
      filename: 'test-1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    expect(row.id).toBeDefined();
    expect(row.status).toBe('uploaded');
    expect(row.kind).toBe('file');
    expect(row.filename).toBe('test-1.pdf');
    expect(row.sizeBytes).toBe(BigInt(1024));
    expect(row.extractedText).toBeNull();

    // Clean up for isolation.
    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, row.id));
  });

  it('defaults pasted-text attachments to status=extracted', async () => {
    const row = await createAttachment({
      sessionId,
      companyId,
      kind: 'pasted-text',
      extractedText: 'pasted content marker',
    });

    expect(row.status).toBe('extracted');
    expect(row.kind).toBe('pasted-text');
    expect(row.extractedText).toBe('pasted content marker');
    expect(row.storageKey).toBeNull();

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, row.id));
  });

  it('accepts an explicit status override', async () => {
    const row = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'test-2.md',
      mimeType: 'text/markdown',
      sizeBytes: 42,
      status: 'extracted',
      extractedText: 'already extracted',
    });

    expect(row.status).toBe('extracted');
    expect(row.extractedText).toBe('already extracted');

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, row.id));
  });
});

// ---- getAttachment --------------------------------------------------------

describe('getAttachment', () => {
  it('returns the row when company matches', async () => {
    const created = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'get-test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 500,
    });

    const found = await getAttachment(created.id, companyId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.filename).toBe('get-test.pdf');

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, created.id));
  });

  it('returns null when the company does not match (cross-tenant)', async () => {
    const created = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'cross-tenant.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 500,
    });

    const found = await getAttachment(created.id, otherCompanyId);
    expect(found).toBeNull();

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, created.id));
  });

  it('returns null for non-existent ids', async () => {
    const found = await getAttachment(
      '00000000-0000-0000-0000-000000000000',
      companyId,
    );
    expect(found).toBeNull();
  });
});

// ---- listAttachmentsForSession --------------------------------------------

describe('listAttachmentsForSession', () => {
  it('returns session attachments in created_at DESC order', async () => {
    const first = await createAttachment({
      sessionId: otherSessionId,
      companyId,
      kind: 'file',
      filename: 'list-1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });
    // Small delay so timestamps differ.
    await new Promise((r) => setTimeout(r, 10));
    const second = await createAttachment({
      sessionId: otherSessionId,
      companyId,
      kind: 'file',
      filename: 'list-2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 200,
    });

    const list = await listAttachmentsForSession(otherSessionId, companyId);
    expect(list).toHaveLength(2);
    // Newest first.
    expect(list[0].filename).toBe('list-2.pdf');
    expect(list[1].filename).toBe('list-1.pdf');

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, first.id));
    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, second.id));
  });

  it('returns [] when the company does not match', async () => {
    const created = await createAttachment({
      sessionId: otherSessionId,
      companyId,
      kind: 'file',
      filename: 'isolated.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    const list = await listAttachmentsForSession(otherSessionId, otherCompanyId);
    expect(list).toEqual([]);

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, created.id));
  });
});

// ---- State transitions ----------------------------------------------------

describe('setExtracted', () => {
  it('transitions uploaded → extracted and populates extracted_text', async () => {
    const created = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'state.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    await setExtracted(created.id, 'the extracted text');

    const found = await getAttachment(created.id, companyId);
    expect(found!.status).toBe('extracted');
    expect(found!.extractedText).toBe('the extracted text');
    expect(found!.extractionError).toBeNull();

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, created.id));
  });

  it('clears a prior extraction_error on success', async () => {
    const created = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'retry.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    await setExtractionError(created.id, 'transient parse failure');
    let found = await getAttachment(created.id, companyId);
    expect(found!.extractionError).toBe('transient parse failure');

    await setExtracted(created.id, 'succeeded on retry');
    found = await getAttachment(created.id, companyId);
    expect(found!.status).toBe('extracted');
    expect(found!.extractedText).toBe('succeeded on retry');
    expect(found!.extractionError).toBeNull();

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, created.id));
  });
});

describe('setExtractionError', () => {
  it('records an error without changing status', async () => {
    const created = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'err.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    await setExtractionError(created.id, 'corrupt PDF');

    const found = await getAttachment(created.id, companyId);
    expect(found!.status).toBe('uploaded'); // unchanged
    expect(found!.extractionError).toBe('corrupt PDF');

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, created.id));
  });
});

describe('markCommitted', () => {
  it('transitions extracted → committed and records the doc id', async () => {
    const created = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'commit.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      status: 'extracted',
      extractedText: 'ready to commit',
    });

    // Seed a real doc row so the FK check passes.
    const [doc] = await db
      .insert(documents)
      .values({
        companyId,
        brainId,
        categoryId,
        title: 'Committed test doc',
        slug: `committed-test-${suffix}`,
        path: `atta-cat-${suffix}/committed-test-${suffix}`,
        content: 'body',
        version: 1,
      })
      .returning({ id: documents.id });

    await markCommitted(created.id, doc.id);

    const found = await getAttachment(created.id, companyId);
    expect(found!.status).toBe('committed');
    expect(found!.committedDocId).toBe(doc.id);

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, created.id));
    await db.delete(documents).where(eq(documents.id, doc.id));
  });
});

describe('discard', () => {
  it('transitions to discarded', async () => {
    const created = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'discard.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    await discard(created.id);

    const found = await getAttachment(created.id, companyId);
    expect(found!.status).toBe('discarded');

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, created.id));
  });
});

// ---- verifySessionOwnership ----------------------------------------------

describe('verifySessionOwnership', () => {
  it('returns { sessionId, companyId } for a matching user', async () => {
    const result = await verifySessionOwnership(sessionId, userId);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(sessionId);
    expect(result!.companyId).toBe(companyId);
  });

  it('returns null when the user does not own the session', async () => {
    const result = await verifySessionOwnership(
      sessionId,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(result).toBeNull();
  });

  it('returns null for a non-existent session', async () => {
    const result = await verifySessionOwnership(
      '00000000-0000-0000-0000-000000000000',
      userId,
    );
    expect(result).toBeNull();
  });
});

// ---- getExtractedAttachmentsForSession ----------------------------------

describe('getExtractedAttachmentsForSession', () => {
  it('returns only rows with status=extracted and populated text', async () => {
    const extracted = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'in.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      status: 'extracted',
      extractedText: 'text in here',
    });
    const uploaded = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'out-uploaded.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      // status defaults to 'uploaded'
    });
    const discarded = await createAttachment({
      sessionId,
      companyId,
      kind: 'file',
      filename: 'out-discarded.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      status: 'discarded',
      extractedText: 'shouldnt come through',
    });

    const results = await getExtractedAttachmentsForSession(sessionId);
    const ids = results.map((r) => r.id);

    expect(ids).toContain(extracted.id);
    expect(ids).not.toContain(uploaded.id);
    expect(ids).not.toContain(discarded.id);

    const row = results.find((r) => r.id === extracted.id)!;
    expect(row.extractedText).toBe('text in here');
    expect(row.sizeBytes).toBe(100);
    expect(typeof row.sizeBytes).toBe('number');

    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, extracted.id));
    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, uploaded.id));
    await db.delete(sessionAttachments).where(eq(sessionAttachments.id, discarded.id));
  });
});

// Schema integration tests.
//
// These tests use DATABASE_URL (superuser role, bypasses RLS) so we can
// insert without a Supabase Auth session. The cross-company RLS test is
// skipped — it requires either SUPABASE_SERVICE_ROLE_KEY + auth
// impersonation or two authenticated client sessions; Task 3 introduces
// those. Running RLS tests against DATABASE_URL would silently pass
// because RLS is bypassed — so we skip rather than fake it.
//
// Each test is self-contained: rows inserted in beforeAll are cleaned up
// in afterAll to avoid polluting the live dev database.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql as dsql, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../schema';
import {
  companies,
  brains,
  folders,
  documents,
  auditEvents,
} from '../schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL must be set for schema tests');
}

// Fresh client per test suite so we can end() cleanly without touching
// the app's singleton in src/db/index.ts.
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client, { schema });

// IDs shared across tests. Populated in beforeAll, cleaned in afterAll.
let companyId: string;
let brainId: string;
let folderId: string;
let documentId: string;

// Use a unique suffix so parallel test runs and existing fixtures don't
// collide on unique indexes (companies.slug, folders brain+slug).
const suffix = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `Schema Test Co ${suffix}`, slug: `schema-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Test Brain', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  const [folder] = await db
    .insert(folders)
    .values({
      companyId,
      brainId,
      slug: 'brand',
      name: 'Brand & Voice',
    })
    .returning({ id: folders.id });
  folderId = folder.id;
});

afterAll(async () => {
  // Deletes cascade: documents -> document_versions, brains -> documents,
  // brains -> folders. companies restricts, so we delete brains
  // explicitly first. audit_events has no FK and is cleaned per-test.
  if (brainId) await db.delete(brains).where(eq(brains.id, brainId));
  if (companyId) {
    await db.delete(companies).where(eq(companies.id, companyId));
  }
  await client.end();
});

describe('schema: FK round-trip', () => {
  it('inserts company -> brain -> folder -> document', async () => {
    const [doc] = await db
      .insert(documents)
      .values({
        companyId,
        brainId,
        folderId,
        title: 'Brand Voice Guide',
        slug: 'brand-voice-guide',
        path: 'brand/brand-voice-guide',
        content: 'We speak plainly.',
      })
      .returning({
        id: documents.id,
        status: documents.status,
        confidenceLevel: documents.confidenceLevel,
        isCore: documents.isCore,
      });
    documentId = doc.id;

    expect(doc.id).toBeDefined();
    expect(doc.status).toBe('draft');
    expect(doc.confidenceLevel).toBe('medium');
    expect(doc.isCore).toBe(false);
  });
});

describe('schema: documents knowledge-architecture defaults', () => {
  it('applies DB-level defaults (draft / medium / is_core=false)', async () => {
    const [doc] = await db
      .insert(documents)
      .values({
        companyId,
        brainId,
        title: 'Defaults Doc',
        slug: `defaults-${suffix}`,
        path: `brand/defaults-${suffix}`,
        content: 'default check',
      })
      .returning();

    expect(doc.status).toBe('draft');
    expect(doc.confidenceLevel).toBe('medium');
    expect(doc.isCore).toBe(false);
    expect(doc.ownerId).toBeNull();

    await db.delete(documents).where(eq(documents.id, doc.id));
  });

  it('persists is_core=true when explicitly set', async () => {
    const [doc] = await db
      .insert(documents)
      .values({
        companyId,
        brainId,
        title: 'Core Doc',
        slug: `core-${suffix}`,
        path: `brand/core-${suffix}`,
        content: 'core content',
        isCore: true,
        status: 'active',
        confidenceLevel: 'high',
      })
      .returning();

    expect(doc.isCore).toBe(true);
    expect(doc.status).toBe('active');
    expect(doc.confidenceLevel).toBe('high');

    await db.delete(documents).where(eq(documents.id, doc.id));
  });
});

describe('schema: tsvector search trigger', () => {
  it('populates search_vector on insert', async () => {
    const rows = await db.execute<{ search_vector: string | null }>(
      dsql`SELECT search_vector::text AS search_vector FROM documents WHERE id = ${documentId}`
    );
    const vector = rows[0]?.search_vector;
    expect(vector).toBeTruthy();
    // English stemmer folds "voice" -> "voic", "plainly" -> "plain".
    // Weights: title tokens end in "A", body tokens end in "B".
    expect(vector).toMatch(/'brand':\d+A/);
    expect(vector).toMatch(/'voic':\d+A/);
    expect(vector).toMatch(/'plain':\d+B/);
  });

  it('refreshes search_vector when title or content changes', async () => {
    await db
      .update(documents)
      .set({ content: 'Updated content mentions pricing explicitly.' })
      .where(eq(documents.id, documentId));

    const rows = await db.execute<{ search_vector: string | null }>(
      dsql`SELECT search_vector::text AS search_vector FROM documents WHERE id = ${documentId}`
    );
    // "pricing" stems to "price", "explicitly" to "explicit".
    expect(rows[0]?.search_vector).toMatch(/'price':\d+B/);
    expect(rows[0]?.search_vector).toMatch(/'explicit':\d+B/);
  });
});

describe('schema: indexes', () => {
  it('has GIN index on documents.search_vector', async () => {
    const rows = await db.execute<{
      indexname: string;
      indexdef: string;
    }>(
      dsql`SELECT indexname, indexdef FROM pg_indexes
            WHERE tablename = 'documents'
              AND indexname = 'documents_search_vector_idx'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].indexdef).toMatch(/gin/i);
    expect(rows[0].indexdef).toMatch(/search_vector/);
  });

  it('has composite (brain_id, status) and (brain_id, is_core) indexes', async () => {
    const rows = await db.execute<{ indexname: string }>(
      dsql`SELECT indexname FROM pg_indexes WHERE tablename = 'documents'`
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('documents_brain_status_idx');
    expect(names).toContain('documents_brain_is_core_idx');
  });

  it('has (company_id, status) composite index on users', async () => {
    const rows = await db.execute<{ indexname: string }>(
      dsql`SELECT indexname FROM pg_indexes WHERE tablename = 'users'`
    );
    expect(rows.map((r) => r.indexname)).toContain('users_company_status_idx');
  });
});

describe('schema: audit_events immutability', () => {
  let auditId: string;

  beforeAll(async () => {
    const [row] = await db
      .insert(auditEvents)
      .values({
        companyId,
        category: 'document_access',
        eventType: 'document.read',
        actorType: 'human',
        actorId: 'test-user',
        details: { tool: 'read_document' },
      })
      .returning({ id: auditEvents.id });
    auditId = row.id;
  });

  afterAll(async () => {
    // Direct DELETE is blocked by the trigger. Use the superuser to drop
    // it temporarily for cleanup.
    await db.execute(
      dsql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable`
    );
    if (auditId) {
      await db
        .delete(auditEvents)
        .where(eq(auditEvents.id, auditId));
    }
    await db.execute(
      dsql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable`
    );
  });

  // The trigger raises 'audit_events is append-only: UPDATE and DELETE
  // are prohibited.'. Drizzle wraps that into "Failed query: ..." but
  // preserves the Postgres error on `cause`. We accept either — the
  // exact wrapping is a Drizzle implementation detail.
  const isImmutabilityError = (err: unknown) => {
    const e = err as { message?: string; cause?: { message?: string } };
    const haystack = `${e.message ?? ''}\n${e.cause?.message ?? ''}`;
    return /append-only|prohibited/i.test(haystack);
  };

  it('rejects UPDATE on audit_events', async () => {
    let caught: unknown;
    try {
      await db
        .update(auditEvents)
        .set({ actorName: 'should-fail' })
        .where(eq(auditEvents.id, auditId));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isImmutabilityError(caught)).toBe(true);
  });

  it('rejects DELETE on audit_events', async () => {
    let caught: unknown;
    try {
      await db.delete(auditEvents).where(eq(auditEvents.id, auditId));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(isImmutabilityError(caught)).toBe(true);
  });
});

describe.skip('schema: RLS cross-company isolation', () => {
  // RLS enforcement requires two authenticated Supabase Auth sessions or
  // the service-role key to impersonate different users via
  // request.jwt.claims. Task 2 has neither available; Task 3 introduces
  // Supabase Auth wiring and can cover this end-to-end. The policies
  // themselves are verified structurally in the "RLS policy presence"
  // test below.
  it('prevents company A from reading company B documents', () => {
    // Intentionally empty — see skip reason above.
  });
});

describe('schema: RLS policy presence', () => {
  it('has company_isolation policy on every company-scoped table', async () => {
    const rows = await db.execute<{ tablename: string; policyname: string }>(
      dsql`SELECT tablename, policyname FROM pg_policies
            WHERE schemaname = 'public'`
    );
    const byTable = new Map<string, string[]>();
    for (const r of rows) {
      const list = byTable.get(r.tablename) ?? [];
      list.push(r.policyname);
      byTable.set(r.tablename, list);
    }
    for (const t of [
      'companies',
      'brains',
      'folders',
      'documents',
      'document_versions',
      'navigation_manifests',
      'agent_access_tokens',
    ]) {
      expect(byTable.get(t) ?? []).toContain('company_isolation');
    }
  });

  it('enables RLS on all company-scoped tables', async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(
      dsql`SELECT c.relname, c.relrowsecurity
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'`
    );
    const rls = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const t of [
      'companies',
      'brains',
      'folders',
      'documents',
      'document_versions',
      'navigation_manifests',
      'users',
      'agent_access_tokens',
      'audit_events',
      'usage_records',
    ]) {
      expect(rls.get(t)).toBe(true);
    }
  });
});

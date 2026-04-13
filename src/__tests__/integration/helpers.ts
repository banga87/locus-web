// Shared helpers for Phase 0 end-to-end integration tests.
//
// These tests run against LIVE Supabase via the Drizzle superuser
// connection (DATABASE_URL). Each test suite creates a fresh company +
// brain + seeded universal-pack documents + owner user, then tears
// everything down in afterAll.
//
// Cleanup note: `document_versions` is append-only (trigger from migration
// 0003). We briefly disable that trigger inside a transaction so the
// brain cascade-delete can reach through version rows — mirroring the
// pattern in `src/lib/tools/__tests__/_fixtures.ts`.

import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import {
  agentAccessTokens,
  auditEvents,
  brains,
  companies,
  mcpConnections,
  sessions,
  usageRecords,
  users,
} from '@/db/schema';
import { createToken } from '@/lib/auth/tokens';
import { seedBrainFromUniversalPack } from '@/lib/templates/seed';

export interface TestCompany {
  companyId: string;
  brainId: string;
  userId: string;
  companySlug: string;
}

/**
 * Create a fresh company + brain + owner user, seed the brain with the
 * Universal Pack. Returns the created ids.
 *
 * `userId` is a fresh UUID v4. We do NOT create an auth.users row — the
 * public.users table has no FK to auth.users (Supabase Auth owns that
 * lifecycle and the public schema references it only by convention).
 * Since DATABASE_URL uses the postgres superuser, RLS policies are
 * bypassed and nothing enforces auth.users presence here.
 */
export async function createSeededCompany(
  suffix: string,
): Promise<TestCompany> {
  const unique = `${suffix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const companySlug = `e2e-${unique}`;
  const userId = randomUUID();

  const [company] = await db
    .insert(companies)
    .values({ name: `E2E Co ${suffix}`, slug: companySlug })
    .returning({ id: companies.id });

  await db.insert(users).values({
    id: userId,
    email: `${unique}@e2e.local`,
    fullName: `E2E ${suffix}`,
    role: 'owner',
    status: 'active',
    companyId: company.id,
  });

  const [brain] = await db
    .insert(brains)
    .values({
      companyId: company.id,
      name: 'Main',
      slug: 'main',
      description: 'E2E seed',
    })
    .returning({ id: brains.id });

  await seedBrainFromUniversalPack(brain.id, company.id);

  return {
    companyId: company.id,
    brainId: brain.id,
    userId,
    companySlug,
  };
}

/**
 * Fully tear down a seeded company. Deletes Phase 1 dependents (sessions,
 * MCP connections, usage records, audit events) plus Phase 0 rows (tokens,
 * users, brain + cascades, company).
 *
 * Order matters: sessions have FKs to `users`, `brains`, `companies`. We
 * drop sessions first so deleting users / brains / companies cannot
 * violate the FK. session_turns cascades via the session FK.
 *
 * `audit_events` has no FK by design (append-only; survives row deletion)
 * but we clean it here so test runs don't accumulate drift on the shared
 * Supabase instance.
 */
export async function cleanupCompany(c: TestCompany): Promise<void> {
  // Phase 1 dependents first — these have FKs pointing into users /
  // brains / companies. audit_events has an immutability trigger (see
  // migration 0003) so we drop it inside a transaction with the
  // trigger briefly disabled, mirroring the document_versions pattern.
  await db.delete(sessions).where(eq(sessions.companyId, c.companyId));
  await db
    .delete(mcpConnections)
    .where(eq(mcpConnections.companyId, c.companyId));
  await db.delete(usageRecords).where(eq(usageRecords.companyId, c.companyId));
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable`,
    );
    await tx.delete(auditEvents).where(eq(auditEvents.companyId, c.companyId));
    await tx.execute(
      sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable`,
    );
  });

  // Users and tokens next (FK targets of companies).
  await db.delete(users).where(eq(users.id, c.userId));
  await db
    .delete(agentAccessTokens)
    .where(eq(agentAccessTokens.companyId, c.companyId));

  // Cascade-delete brain inside a transaction with the immutability
  // trigger disabled so document_versions rows can go with it.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, c.brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });

  await db.delete(companies).where(eq(companies.id, c.companyId));
}

/**
 * Create an agent access token bound to the given company + user. Returns
 * the raw token (the value MCP clients send as Bearer) and the row id so
 * tests can revoke it later.
 */
export async function createTestToken(
  companyId: string,
  userId: string,
  name = 'e2e',
): Promise<{ token: string; tokenId: string }> {
  const { token, record } = await createToken({
    companyId,
    name,
    createdBy: userId,
  });
  return { token, tokenId: record.id };
}

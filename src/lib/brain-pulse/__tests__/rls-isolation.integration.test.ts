// Cross-company isolation guarantee for audit_events SELECT RLS policy.
//
// APPROACH: Option B — pure SQL RLS proof (not live Realtime WebSocket).
//
// Option A (real Realtime subscription via publishable key) was attempted
// first and failed with a subscribe timeout: the publishable key requires an
// authenticated JWT session to satisfy auth.uid() inside the SELECT RLS
// policy. The jsdom/node test environment cannot complete the Supabase Auth
// handshake, so the WebSocket never reaches SUBSCRIBED status.
//
// Option B is more reliable in CI: inside a Postgres transaction we:
//   1. SET LOCAL ROLE authenticated — switches to the role the RLS policy
//      targets (the "TO authenticated" clause in CREATE POLICY).
//   2. SET LOCAL request.jwt.claims — injects a fake JWT payload so that
//      auth.uid() returns a real user ID from the users table.
//   3. Execute SELECT … FROM audit_events WHERE brain_id = brainY.id and
//      assert ZERO rows are returned (the RLS policy's USING clause blocks it).
//   4. Execute SELECT … FROM audit_events WHERE brain_id = brainX.id and
//      assert the expected row IS returned (liveness check).
//
// This directly exercises the SQL policy in migration 0014 and will catch
// any regression if the policy is edited or dropped.
//
// NOTE: For the manual/E2E equivalent see Task 22 QA checklist, which covers
// the live Realtime WebSocket path with a real authenticated browser session.
//
// ENVIRONMENT: needs DATABASE_URL (loaded from .env via vitest.setup.ts) and
// at least one row each in: companies, brains, users, audit_events (or seeds
// that row here). DATABASE_URL is present in the dev environment.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { db, pgClient } from '@/db';
import { brains, companies, users, auditEvents } from '@/db/schema';

describe('audit_events cross-company isolation (RLS policy — SQL proof)', () => {
  let brainX: { id: string; companyId: string } | null = null;
  let brainY: { id: string; companyId: string } | null = null;
  // A real user in company X. The RLS policy resolves company via
  // `SELECT company_id FROM users WHERE id = auth.uid()`.
  let userX: { id: string; companyId: string } | null = null;
  let setupSkipped = false;

  // IDs we synthesise — cleaned up in afterAll.
  let synthCompanyId: string | null = null;
  let synthBrainId: string | null = null;
  // Actor sentinel used to scope SELECT assertions to this test run.
  let uniqueActor: string | null = null;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      console.warn('[rls-isolation] DATABASE_URL missing; skipping');
      setupSkipped = true;
      return;
    }

    // ── 1. Resolve brainX — any existing brain with a matching user ────────
    // We need a user whose company_id matches the brain's company_id so the
    // RLS USING clause resolves correctly.
    const [xu] = await db
      .select({ id: users.id, companyId: users.companyId })
      .from(users)
      .where(sql`${users.companyId} IS NOT NULL`)
      .limit(1);

    if (!xu?.companyId) {
      console.warn('[rls-isolation] no users with companyId found in DB; skipping');
      setupSkipped = true;
      return;
    }
    userX = { id: xu.id, companyId: xu.companyId };

    const [x] = await db
      .select({ id: brains.id, companyId: brains.companyId })
      .from(brains)
      .where(eq(brains.companyId, xu.companyId))
      .limit(1);

    if (!x) {
      console.warn('[rls-isolation] no brains for user X company; skipping');
      setupSkipped = true;
      return;
    }
    brainX = x;

    // ── 2. Synthesise company Y + brain Y ──────────────────────────────────
    synthCompanyId = crypto.randomUUID();
    synthBrainId = crypto.randomUUID();

    await db.insert(companies).values({
      id: synthCompanyId,
      name: '[test] rls-isolation company Y',
      slug: `test-rls-co-${synthCompanyId.slice(0, 8)}`,
    });

    await db.insert(brains).values({
      id: synthBrainId,
      companyId: synthCompanyId,
      name: '[test] rls-isolation brain Y',
      slug: `test-rls-br-${synthBrainId.slice(0, 8)}`,
    });

    brainY = { id: synthBrainId, companyId: synthCompanyId };

    // ── 3. Insert test rows (superuser role — bypasses RLS for setup) ──────
    uniqueActor = `rls-iso-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await db.insert(auditEvents).values([
      {
        // Foreign event: brain Y (company Y — should be hidden from user X).
        companyId: brainY.companyId,
        brainId: brainY.id,
        actorType: 'system',
        actorId: uniqueActor,
        actorName: '[test] rls-isolation foreign',
        category: 'document_access',
        eventType: 'document.read',
        details: { marker: 'foreign' },
      },
      {
        // Own event: brain X (company X — should be visible to user X).
        companyId: brainX.companyId,
        brainId: brainX.id,
        actorType: 'system',
        actorId: uniqueActor,
        actorName: '[test] rls-isolation own',
        category: 'document_access',
        eventType: 'document.read',
        details: { marker: 'own' },
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    // audit_events are immutable — skip trying to DELETE them.
    // Clean up the synthesised brain/company rows.
    if (synthBrainId) {
      try {
        await db.delete(brains).where(eq(brains.id, synthBrainId));
      } catch {
        // ignore
      }
    }
    if (synthCompanyId) {
      try {
        await db.delete(companies).where(eq(companies.id, synthCompanyId));
      } catch {
        // ignore
      }
    }
  });

  it(
    'RLS policy blocks SELECT of a foreign company brain event, allows own company brain event',
    async () => {
      if (setupSkipped || !brainX || !brainY || !userX || !uniqueActor) {
        console.warn(
          '[rls-isolation] preconditions not met (no brains/users or missing env); test intentionally skipped',
        );
        return;
      }

      // Run both queries inside a single transaction so SET LOCAL applies to
      // exactly this session without leaking to other concurrent tests.
      const result = await pgClient.begin(async (tx) => {
        // Inject the JWT claims that auth.uid() and auth.jwt() read.
        // Supabase's PostgREST sets these as a GUC before evaluating RLS.
        const jwtClaims = JSON.stringify({ sub: userX!.id, role: 'authenticated' });
        await tx`SET LOCAL ROLE authenticated`;
        await tx`SELECT set_config('request.jwt.claims', ${jwtClaims}, true)`;

        // Query 1: foreign brain — RLS USING clause should block this.
        const foreignRows = await tx<Array<{ id: string; actor_id: string }>>`
          SELECT id, actor_id
          FROM audit_events
          WHERE brain_id = ${brainY!.id}
            AND actor_id = ${uniqueActor!}
        `;

        // Query 2: own brain — RLS USING clause should allow this.
        const ownRows = await tx<Array<{ id: string; actor_id: string }>>`
          SELECT id, actor_id
          FROM audit_events
          WHERE brain_id = ${brainX!.id}
            AND actor_id = ${uniqueActor!}
        `;

        return { foreignRows, ownRows };
      });

      // Primary security assertion: cross-company event must NOT be visible.
      expect(result.foreignRows).toHaveLength(0);

      // Liveness assertion: own company event MUST be visible.
      // Without this passing, the foreignRows assertion would be vacuous
      // (e.g. if the whole table were empty).
      expect(result.ownRows.length).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );
});

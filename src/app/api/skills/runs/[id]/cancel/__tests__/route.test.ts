/**
 * @vitest-environment node
 */
// Integration test for POST /api/skills/runs/[id]/cancel.
//
// Relocated from /api/workflows/runs/[id]/cancel during the skill/workflow
// unification. The underlying workflow_runs table keeps its name; only the
// HTTP path moved. Fixture docs are seeded as type='skill' with a nested
// `trigger:` block in metadata to match the new shape.
//
// Coverage:
//   1. Happy path — running run is flipped to 'cancelled' and an
//      audit_events row with event_type='workflow.run.cancelled' is
//      inserted.
//   2. Terminal-state guard — cancelling a completed run returns 409
//      and emits no audit event.
//   3. Cross-tenant denial — owner of Company B cannot cancel a run
//      owned by Company A, even knowing the run UUID.
//
// Strategy mirrors the trigger route's integration test: real DB via
// DATABASE_URL, mocked auth and mocked waitUntil. flushEvents is called
// inline so the buffered audit row lands before we query.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { auditEvents } from '@/db/schema/audit-events';
import { flushEvents, __resetForTests as resetAuditForTests } from '@/lib/audit/logger';

// --- Module mocks (must precede route import) ---------------------------

const mockAuth: {
  userId: string;
  companyId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  email: string;
  fullName: string | null;
} = {
  userId: '',
  companyId: '',
  role: 'owner',
  email: 'cancel-test@local',
  fullName: 'Cancel Test User',
};

const mockRequireAuth = vi.fn(async () => ({ ...mockAuth }));

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>(
    '@/lib/api/auth',
  );
  return {
    ...actual,
    // `requireAuth()` takes no arguments — forwarding via `(...args)` trips
    // TS2556 because `mockRequireAuth` has a fixed `()` signature. A plain
    // thunk matches the real signature and avoids the spread-argument gap.
    requireAuth: () => mockRequireAuth(),
  };
});

// waitUntil: run the promise eagerly so flushEvents() lands before the
// test queries audit_events. Same pattern as chat route integration test.
const waitUntilPromises: Array<Promise<unknown>> = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(Promise.resolve(p).catch(() => {}));
  },
}));

// Import the route AFTER mocks are installed.
import { POST } from '@/app/api/skills/runs/[id]/cancel/route';

// --- Fixtures -----------------------------------------------------------

const suffix = `cancel-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let skillDocId: string;

// Secondary tenant — used to prove cross-tenant access is rejected even
// when the caller holds role=owner in their own tenant.
let otherCompanyId: string;
let otherBrainId: string;
let otherUserId: string;

beforeAll(async () => {
  resetAuditForTests();

  const [company] = await db
    .insert(companies)
    .values({ name: `Cancel Co ${suffix}`, slug: `cn-${suffix}` })
    .returning({ id: companies.id });
  companyId = company!.id;

  const mintedUserId = randomUUID();
  await db.insert(users).values({
    id: mintedUserId,
    email: `${suffix}@cancel.local`,
    fullName: `Cancel Tester ${suffix}`,
    role: 'owner',
    status: 'active',
    companyId,
  });
  userId = mintedUserId;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Cancel Brain', slug: `cn-brain-${suffix}` })
    .returning({ id: brains.id });
  brainId = brain!.id;

  const [folder] = await db
    .insert(folders)
    .values({
      companyId,
      brainId,
      slug: `cn-folder-${suffix}`,
      name: 'Cancels',
    })
    .returning({ id: folders.id });

  const [skillDoc] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId: folder!.id,
      title: 'Cancel Skill',
      slug: `cancel-skill-${suffix}`,
      path: `cn-folder-${suffix}/cancel-skill-${suffix}`,
      content:
        '---\ntype: skill\ntrigger:\n  output: document\n  requires_mcps: []\n---\nTest.',
      type: 'skill',
      metadata: {
        trigger: {
          output: 'document',
          requires_mcps: [],
          output_category: null,
          schedule: null,
        },
      },
      version: 1,
    })
    .returning({ id: documents.id });
  skillDocId = skillDoc!.id;

  // Secondary tenant — owner of Company B. They must NOT be able to
  // read/cancel runs owned by Company A even knowing the run UUID.
  const [otherCompany] = await db
    .insert(companies)
    .values({ name: `Other Cancel Co ${suffix}`, slug: `ocn-${suffix}` })
    .returning({ id: companies.id });
  otherCompanyId = otherCompany!.id;

  const mintedOtherUserId = randomUUID();
  await db.insert(users).values({
    id: mintedOtherUserId,
    email: `other-${suffix}@cancel.local`,
    fullName: `Other Cancel Tester ${suffix}`,
    role: 'owner',
    status: 'active',
    companyId: otherCompanyId,
  });
  otherUserId = mintedOtherUserId;

  const [otherBrain] = await db
    .insert(brains)
    .values({
      companyId: otherCompanyId,
      name: 'Other Brain',
      slug: `ocn-brain-${suffix}`,
    })
    .returning({ id: brains.id });
  otherBrainId = otherBrain!.id;

  mockAuth.userId = userId;
  mockAuth.companyId = companyId;
}, 60_000);

afterAll(async () => {
  // audit_events has an immutability trigger; briefly disable inside a
  // transaction so we can clean up. Matches the chat route test teardown.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable`,
    );
    await tx.delete(auditEvents).where(eq(auditEvents.companyId, companyId));
    await tx.execute(
      sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable`,
    );
  });
  await db
    .delete(workflowRuns)
    .where(eq(workflowRuns.workflowDocumentId, skillDocId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(brains).where(eq(brains.id, brainId));
  await db.delete(companies).where(eq(companies.id, companyId));
  // Secondary tenant cleanup — brains CASCADE to docs + folders.
  await db.delete(users).where(eq(users.id, otherUserId));
  await db.delete(brains).where(eq(brains.id, otherBrainId));
  await db.delete(companies).where(eq(companies.id, otherCompanyId));
}, 60_000);

// --- Helpers ------------------------------------------------------------

async function seedRunningRun(): Promise<string> {
  const [row] = await db
    .insert(workflowRuns)
    .values({
      workflowDocumentId: skillDocId,
      triggeredBy: userId,
      status: 'running',
    })
    .returning({ id: workflowRuns.id });
  return row!.id;
}

async function seedCompletedRun(): Promise<string> {
  const [row] = await db
    .insert(workflowRuns)
    .values({
      workflowDocumentId: skillDocId,
      triggeredBy: userId,
      status: 'completed',
    })
    .returning({ id: workflowRuns.id });
  return row!.id;
}

function buildCancelRequest(): Request {
  return new Request('http://localhost/api/skills/runs/x/cancel', {
    method: 'POST',
  });
}

async function flushWaitUntil(): Promise<void> {
  const pending = [...waitUntilPromises];
  waitUntilPromises.length = 0;
  await Promise.all(pending);
}

// --- Tests --------------------------------------------------------------

describe('POST /api/skills/runs/[id]/cancel', () => {
  it(
    'emits workflow.run.cancelled audit event on successful cancel',
    async () => {
      const runId = await seedRunningRun();

      const res = await POST(buildCancelRequest(), {
        params: Promise.resolve({ id: runId }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { run_id: string; status: string };
      expect(body.status).toBe('cancelled');

      // 1. Row state: flipped to 'cancelled'.
      const [row] = await db
        .select({ status: workflowRuns.status })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, runId))
        .limit(1);
      expect(row!.status).toBe('cancelled');

      // 2. Audit event landed. Drain the waitUntil(flushEvents()) call first,
      // then as a belt-and-braces measure call flushEvents() inline in case
      // the microtask-scheduled drain hasn't run yet.
      await flushWaitUntil();
      await flushEvents();

      const events = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.companyId, companyId),
            eq(auditEvents.eventType, 'workflow.run.cancelled'),
            eq(auditEvents.targetId, runId),
          ),
        );
      expect(events).toHaveLength(1);
    },
    30_000,
  );

  it(
    'returns 409 and emits no audit event when the run is already terminal',
    async () => {
      const runId = await seedCompletedRun();

      const res = await POST(buildCancelRequest(), {
        params: Promise.resolve({ id: runId }),
      });
      expect(res.status).toBe(409);

      await flushWaitUntil();
      await flushEvents();

      // No workflow.run.cancelled event for this runId — the row never
      // transitioned.
      const events = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.companyId, companyId),
            eq(auditEvents.eventType, 'workflow.run.cancelled'),
            eq(auditEvents.targetId, runId),
          ),
        );
      expect(events).toHaveLength(0);
    },
    30_000,
  );

  it(
    'returns 404 (not 403) on cross-tenant access — owner of Company B cannot cancel Company A run',
    async () => {
      // Seed a run owned by Company A (fixture tenant).
      const runId = await seedRunningRun();

      // Override auth to present as the owner of Company B.
      mockRequireAuth.mockResolvedValueOnce({
        userId: otherUserId,
        companyId: otherCompanyId,
        role: 'owner',
        email: `other-${suffix}@cancel.local`,
        fullName: `Other Cancel Tester ${suffix}`,
      });

      const res = await POST(buildCancelRequest(), {
        params: Promise.resolve({ id: runId }),
      });

      // 404 (not 403) — do not leak UUID existence across tenants.
      expect(res.status).toBe(404);

      // Row state unchanged — still 'running'.
      const [row] = await db
        .select({ status: workflowRuns.status })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, runId))
        .limit(1);
      expect(row!.status).toBe('running');

      // No audit event emitted for the cross-tenant caller.
      await flushWaitUntil();
      await flushEvents();
      const events = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.eventType, 'workflow.run.cancelled'),
            eq(auditEvents.targetId, runId),
          ),
        );
      expect(events).toHaveLength(0);

      // Clean up the still-running row to keep teardown deterministic.
      await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));
    },
    30_000,
  );
});

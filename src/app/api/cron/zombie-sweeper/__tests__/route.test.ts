/**
 * @vitest-environment node
 */
// Tests for GET /api/cron/zombie-sweeper.
//
// Part 1 — Unit: HTTP auth checks (CRON_SECRET verification) with no DB.
// Part 2 — Integration: seeds a workflow_run with updated_at 20min ago,
//           calls sweepZombies directly, asserts status flipped to 'failed'.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';

import { sweepZombies } from '@/lib/workflow/queries';

// Import the route handler.
import { GET } from '@/app/api/cron/zombie-sweeper/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const suffix = `zombie-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let workflowDocId: string;

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `Zombie Co ${suffix}`, slug: `zb-${suffix}` })
    .returning({ id: companies.id });
  companyId = company!.id;

  const mintedUserId = randomUUID();
  await db.insert(users).values({
    id: mintedUserId,
    email: `${suffix}@zombie.local`,
    fullName: `Zombie Tester ${suffix}`,
    role: 'owner',
    status: 'active',
    companyId,
  });
  userId = mintedUserId;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Zombie Brain', slug: `zb-brain-${suffix}` })
    .returning({ id: brains.id });
  brainId = brain!.id;

  const [folder] = await db
    .insert(folders)
    .values({
      companyId,
      brainId,
      slug: `zb-folder-${suffix}`,
      name: 'Zombies',
    })
    .returning({ id: folders.id });

  const [wfDoc] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId: folder!.id,
      title: 'Zombie Triggered Skill',
      slug: `zombie-skill-${suffix}`,
      path: `zb-folder-${suffix}/zombie-skill-${suffix}`,
      content:
        '---\ntype: skill\ntrigger:\n  output: document\n  output_category: null\n  requires_mcps: []\n  schedule: null\n---\nTest.',
      type: 'skill',
      metadata: {
        trigger: {
          output: 'document',
          output_category: null,
          requires_mcps: [],
          schedule: null,
        },
      },
      version: 1,
    })
    .returning({ id: documents.id });
  workflowDocId = wfDoc!.id;
}, 60_000);

afterAll(async () => {
  await db
    .delete(workflowRuns)
    .where(eq(workflowRuns.workflowDocumentId, workflowDocId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(brains).where(eq(brains.id, brainId));
  await db.delete(companies).where(eq(companies.id, companyId));
}, 60_000);

// ---------------------------------------------------------------------------
// Helper: insert a run with updated_at forced to N minutes ago.
// ---------------------------------------------------------------------------

async function seedStaleRun(minutesAgo: number): Promise<string> {
  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowDocumentId: workflowDocId,
      triggeredBy: userId,
      status: 'running',
    })
    .returning({ id: workflowRuns.id });

  // Force updated_at into the past using a raw UPDATE with interval arithmetic.
  // This is the only reliable way to manufacture a "stale" row — JS Date math
  // would require waiting real time.
  await db.execute(
    sql`UPDATE workflow_runs
        SET updated_at = now() - interval '${sql.raw(String(minutesAgo))} minutes'
        WHERE id = ${run!.id}`,
  );

  return run!.id;
}

// ---------------------------------------------------------------------------
// Part 1 — HTTP auth unit tests (no live DB work beyond fixture setup)
// ---------------------------------------------------------------------------

describe('GET /api/cron/zombie-sweeper — auth', () => {
  const origSecret = process.env.CRON_SECRET;

  afterAll(() => {
    if (origSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = origSecret;
    }
  });

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET;
    const req = new Request('http://localhost/api/cron/zombie-sweeper');
    const res = await GET(req);
    expect(res.status).toBe(500);
  });

  it('returns 401 when Authorization header is missing', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const req = new Request('http://localhost/api/cron/zombie-sweeper');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header has wrong secret', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const req = new Request('http://localhost/api/cron/zombie-sweeper', {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 with swept count when auth is correct', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const req = new Request('http://localhost/api/cron/zombie-sweeper', {
      headers: { authorization: 'Bearer test-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json() as { swept: number };
    expect(typeof body.swept).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Part 2 — Integration: zombie detection
// ---------------------------------------------------------------------------

describe('sweepZombies — DB integration', () => {
  it('flips a run stuck running for 20 min to failed', async () => {
    const runId = await seedStaleRun(20);

    try {
      const swept = await sweepZombies({ inactivityMinutes: 15 });

      // At least 1 run was swept (there may be others from prior test noise
      // on a shared DB, so we assert >= 1 not === 1).
      expect(swept).toBeGreaterThanOrEqual(1);

      const [row] = await db
        .select({ status: workflowRuns.status, errorMessage: workflowRuns.errorMessage })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, runId))
        .limit(1);

      expect(row!.status).toBe('failed');
      expect(row!.errorMessage).toBe('Run exceeded inactivity window');
    } finally {
      await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));
    }
  });

  it('does not touch a run that was active 5 min ago (below 15min threshold)', async () => {
    const runId = await seedStaleRun(5);

    try {
      await sweepZombies({ inactivityMinutes: 15 });

      const [row] = await db
        .select({ status: workflowRuns.status })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, runId))
        .limit(1);

      // Should still be running — not old enough to be swept.
      expect(row!.status).toBe('running');
    } finally {
      await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));
    }
  });

  it('does not touch runs already in terminal states', async () => {
    // Insert a 'completed' run with updated_at 20min ago — sweeper must ignore it.
    const [run] = await db
      .insert(workflowRuns)
      .values({
        workflowDocumentId: workflowDocId,
        triggeredBy: userId,
        status: 'completed',
      })
      .returning({ id: workflowRuns.id });

    await db.execute(
      sql`UPDATE workflow_runs SET updated_at = now() - interval '20 minutes' WHERE id = ${run!.id}`,
    );

    try {
      await sweepZombies({ inactivityMinutes: 15 });

      const [row] = await db
        .select({ status: workflowRuns.status })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, run!.id))
        .limit(1);

      expect(row!.status).toBe('completed');
    } finally {
      await db.delete(workflowRuns).where(eq(workflowRuns.id, run!.id));
    }
  });
});

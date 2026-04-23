// status.ts tests — DB integration tests for workflow run lifecycle helpers.
//
// Seeds a real workflow_run row, calls each helper, and asserts the row
// was updated correctly, including that updated_at is bumped.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';

import {
  markRunning,
  markCompleted,
  markFailed,
  markCancelled,
  getRunStatus,
} from '../status';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface StatusFixtures {
  companyId: string;
  brainId: string;
  userId: string;
  workflowDocId: string;
}

async function setupStatusFixtures(): Promise<StatusFixtures> {
  const suffix = `status-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Status Co ${suffix}`, slug: `st-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company!.id, name: 'Status Brain', slug: 'st-brain' })
    .returning({ id: brains.id });

  const [folder] = await db
    .insert(folders)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      slug: 'wf',
      name: 'Workflows',
    })
    .returning({ id: folders.id });

  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    companyId: company!.id,
    fullName: 'Status User',
    email: `status-${suffix}@example.test`,
    status: 'active',
  });

  const [wfDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: 'Status WF',
      slug: 'status-wf',
      path: 'wf/status-wf',
      content:
        '---\ntype: skill\ntrigger:\n  output: document\n  output_category: null\n  requires_mcps: []\n  schedule: null\n---\nTest.',
      type: 'skill',
      version: 1,
    })
    .returning({ id: documents.id });

  return {
    companyId: company!.id,
    brainId: brain!.id,
    userId,
    workflowDocId: wfDoc!.id,
  };
}

async function teardownStatusFixtures(f: StatusFixtures): Promise<void> {
  // workflow_runs has a FK to users (triggered_by RESTRICT) so runs must
  // be deleted before users. Cascade from brains covers documents + folders.
  await db.delete(workflowRuns).where(eq(workflowRuns.workflowDocumentId, f.workflowDocId));
  await db.delete(users).where(eq(users.id, f.userId));
  await db.delete(brains).where(eq(brains.id, f.brainId));
  await db.delete(companies).where(eq(companies.id, f.companyId));
}

/** Seed a fresh run row in 'queued' status for each test. */
async function seedRun(f: StatusFixtures): Promise<string> {
  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowDocumentId: f.workflowDocId,
      triggeredBy: f.userId,
      status: 'queued',
    })
    .returning({ id: workflowRuns.id });
  return run!.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let fix: StatusFixtures;

beforeAll(async () => {
  fix = await setupStatusFixtures();
});

afterAll(async () => {
  await teardownStatusFixtures(fix);
});

describe('markRunning', () => {
  it('sets status=running and bumps updated_at', async () => {
    const runId = await seedRun(fix);
    const [before] = await db
      .select({ updatedAt: workflowRuns.updatedAt })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));
    const tBefore = before!.updatedAt;

    // Ensure DB clock has advanced before the status update.
    const deadline = Date.now() + 10;
    while (Date.now() < deadline) { /* spin */ }

    await markRunning(runId);

    const [row] = await db
      .select({ status: workflowRuns.status, updatedAt: workflowRuns.updatedAt })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));

    expect(row!.status).toBe('running');
    // Zombie sweeper depends on updated_at advancing — see JSDoc on
    // workflow_runs.updatedAt.
    expect(row!.updatedAt.getTime()).toBeGreaterThan(tBefore.getTime());

    await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));
  });
});

describe('markCompleted', () => {
  it('sets status=completed, records token counts, and bumps updated_at', async () => {
    const runId = await seedRun(fix);
    const [before] = await db
      .select({ updatedAt: workflowRuns.updatedAt })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));
    const tBefore = before!.updatedAt;

    // Ensure DB clock has advanced before the status update.
    const deadline = Date.now() + 10;
    while (Date.now() < deadline) { /* spin */ }

    await markCompleted(runId, {
      summary: 'Done in 2 steps.',
      inputTokens: 1500,
      outputTokens: 300,
      costUsd: 0.0045,
    });

    const [row] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));

    expect(row!.status).toBe('completed');
    // Zombie sweeper depends on updated_at advancing — see JSDoc on
    // workflow_runs.updatedAt.
    expect(row!.updatedAt.getTime()).toBeGreaterThan(tBefore.getTime());
    expect(row!.summary).toBe('Done in 2 steps.');
    expect(row!.totalInputTokens).toBe(1500);
    expect(row!.totalOutputTokens).toBe(300);
    expect(Number(row!.totalCostUsd)).toBeCloseTo(0.0045);
    expect(row!.completedAt).not.toBeNull();

    await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));
  });

  it('accepts null summary', async () => {
    const runId = await seedRun(fix);
    await markCompleted(runId, { summary: null, inputTokens: 0, outputTokens: 0 });
    const [row] = await db
      .select({ summary: workflowRuns.summary })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));
    expect(row!.summary).toBeNull();
    await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));
  });
});

describe('markFailed', () => {
  it('sets status=failed with errorMessage and bumps updated_at', async () => {
    const runId = await seedRun(fix);
    const [before] = await db
      .select({ updatedAt: workflowRuns.updatedAt })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));
    const tBefore = before!.updatedAt;

    // Ensure DB clock has advanced before the status update.
    const deadline = Date.now() + 10;
    while (Date.now() < deadline) { /* spin */ }

    await markFailed(runId, 'LLM quota exceeded');

    const [row] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));

    expect(row!.status).toBe('failed');
    expect(row!.errorMessage).toBe('LLM quota exceeded');
    // Zombie sweeper depends on updated_at advancing — see JSDoc on
    // workflow_runs.updatedAt.
    expect(row!.updatedAt.getTime()).toBeGreaterThan(tBefore.getTime());

    await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));
  });
});

describe('markCancelled', () => {
  it('sets status=cancelled and bumps updated_at', async () => {
    const runId = await seedRun(fix);
    const [before] = await db
      .select({ updatedAt: workflowRuns.updatedAt })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));
    const tBefore = before!.updatedAt;

    // Ensure DB clock has advanced before the status update.
    const deadline = Date.now() + 10;
    while (Date.now() < deadline) { /* spin */ }

    await markCancelled(runId);

    const [row] = await db
      .select({ status: workflowRuns.status, updatedAt: workflowRuns.updatedAt })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId));

    expect(row!.status).toBe('cancelled');
    expect(row!.updatedAt.getTime()).toBeGreaterThan(tBefore.getTime());

    await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));
  });
});

describe('getRunStatus', () => {
  it('returns the current status string', async () => {
    const runId = await seedRun(fix);
    await markRunning(runId);
    const status = await getRunStatus(runId);
    expect(status).toBe('running');
    await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));
  });

  it('returns null for an unknown runId', async () => {
    const status = await getRunStatus(randomUUID());
    expect(status).toBeNull();
  });
});

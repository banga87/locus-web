// events.ts tests — insertEvent persists a workflow_run_events row.
//
// These are integration tests that hit the real DB. They share the same
// setup/teardown pattern as the tool tests: seed a company/brain/user/
// workflow_run row, call insertEvent, verify the row, clean up.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { users } from '@/db/schema/users';
import { documents } from '@/db/schema/documents';
import { folders } from '@/db/schema/folders';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { workflowRunEvents } from '@/db/schema/workflow-run-events';

import { insertEvent } from '../events';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface EventFixtures {
  companyId: string;
  brainId: string;
  userId: string;
  workflowDocId: string;
  runId: string;
}

async function setupEventFixtures(): Promise<EventFixtures> {
  const suffix = `evttest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Evt Co ${suffix}`, slug: `evt-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company!.id, name: 'Evt Brain', slug: 'evt-brain' })
    .returning({ id: brains.id });

  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    companyId: company!.id,
    fullName: 'Evt User',
    email: `evt-${suffix}@example.test`,
    status: 'active',
  });

  // Need a folder for the workflow doc
  const [folder] = await db
    .insert(folders)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      slug: 'workflows',
      name: 'Workflows',
    })
    .returning({ id: folders.id });

  // Minimal triggered-skill document
  const [wfDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: 'Test Triggered Skill',
      slug: 'test-triggered-skill',
      path: 'workflows/test-triggered-skill',
      content:
        '---\ntype: skill\ntrigger:\n  output: document\n  output_category: null\n  requires_mcps: []\n  schedule: null\n---\nDo things.',
      type: 'skill',
      version: 1,
    })
    .returning({ id: documents.id });

  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowDocumentId: wfDoc!.id,
      triggeredBy: userId,
      triggeredByKind: 'manual',
      status: 'running',
    })
    .returning({ id: workflowRuns.id });

  return {
    companyId: company!.id,
    brainId: brain!.id,
    userId,
    workflowDocId: wfDoc!.id,
    runId: run!.id,
  };
}

async function teardownEventFixtures(f: EventFixtures): Promise<void> {
  // workflow_run_events cascade from workflow_runs
  // workflow_runs restrict on documents and users — delete run first
  await db.delete(workflowRuns).where(eq(workflowRuns.id, f.runId));
  await db.delete(users).where(eq(users.id, f.userId));
  // brains cascade to documents + folders
  await db.delete(brains).where(eq(brains.id, f.brainId));
  await db.delete(companies).where(eq(companies.id, f.companyId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let fix: EventFixtures;

beforeAll(async () => {
  fix = await setupEventFixtures();
});

afterAll(async () => {
  await teardownEventFixtures(fix);
});

describe('insertEvent', () => {
  it('persists an event row with the correct runId, sequence, type and payload', async () => {
    await insertEvent(fix.runId, 0, 'turn_start', { turnNumber: 0 });

    const rows = await db
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, fix.runId));

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.runId).toBe(fix.runId);
    expect(row.sequence).toBe(0);
    expect(row.eventType).toBe('turn_start');
    expect(row.payload).toMatchObject({ turnNumber: 0 });
  });

  it('persists multiple events in sequence order', async () => {
    // Use a fresh run to avoid collisions with the previous test
    const [run2] = await db
      .insert(workflowRuns)
      .values({
        workflowDocumentId: fix.workflowDocId,
        triggeredBy: fix.userId,
        status: 'running',
      })
      .returning({ id: workflowRuns.id });

    const runId2 = run2!.id;

    await insertEvent(runId2, 0, 'turn_start', {});
    await insertEvent(runId2, 1, 'llm_delta', { delta: 'hello' });
    await insertEvent(runId2, 2, 'turn_complete', { finishReason: 'stop' });

    const rows = await db
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, runId2))
      .orderBy(workflowRunEvents.sequence);

    expect(rows).toHaveLength(3);
    expect(rows[0]!.sequence).toBe(0);
    expect(rows[0]!.eventType).toBe('turn_start');
    expect(rows[1]!.sequence).toBe(1);
    expect(rows[1]!.eventType).toBe('llm_delta');
    expect(rows[2]!.sequence).toBe(2);
    expect(rows[2]!.eventType).toBe('turn_complete');

    // Cleanup this secondary run
    await db.delete(workflowRuns).where(eq(workflowRuns.id, runId2));
  });

  it('accepts an empty payload object', async () => {
    const [run3] = await db
      .insert(workflowRuns)
      .values({
        workflowDocumentId: fix.workflowDocId,
        triggeredBy: fix.userId,
        status: 'running',
      })
      .returning({ id: workflowRuns.id });

    await insertEvent(run3!.id, 0, 'run_complete', {});

    const rows = await db
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, run3!.id));

    expect(rows[0]!.payload).toMatchObject({});

    await db.delete(workflowRuns).where(eq(workflowRuns.id, run3!.id));
  });
});

// Smoke tests for workflow_runs + workflow_run_events tables.
//
// Uses DATABASE_URL (superuser role, bypasses RLS) — same pattern as
// src/db/__tests__/schema.test.ts. Rows are self-contained: a test
// company, brain, document, and user are created in beforeAll and fully
// cleaned up in afterAll.
//
// Verifies:
//   - FK integrity (workflow_runs → documents + users)
//   - INSERT/SELECT round-trip on both tables
//   - Sequence ordering
//   - ON DELETE CASCADE (delete run → events vanish)

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../schema';
import {
  companies,
  brains,
  documents,
  workflowRuns,
  workflowRunEvents,
} from '../schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL must be set for workflow-tables tests');
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client, { schema });

// Use a unique suffix to avoid collisions with other test runs.
const suffix = `wf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let companyId: string;
let brainId: string;
let documentId: string;
// We need a real users row for the triggered_by FK. In the test DB we
// can insert directly (superuser bypasses RLS). We use a fixed UUID that
// won't collide with real auth.users rows.
const testUserId = '00000000-0000-0000-0000-000000000001';

beforeAll(async () => {
  // Company
  const [company] = await db
    .insert(companies)
    .values({ name: `WF Test Co ${suffix}`, slug: `wf-co-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  // Brain
  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'WF Brain', slug: 'wf-main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  // Workflow document (type: workflow satisfies FK; content irrelevant here)
  const [doc] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      title: 'Test Workflow',
      slug: `test-workflow-${suffix}`,
      path: `test-workflow-${suffix}`,
      content: '---\ntype: workflow\n---\n',
      type: 'workflow',
    })
    .returning({ id: documents.id });
  documentId = doc.id;

  // Ensure a users row exists for the triggered_by FK.
  // Insert idempotently — the row may already exist from another test run.
  await db
    .insert(schema.users)
    .values({
      id: testUserId,
      fullName: 'Test User',
      email: `test-${suffix}@example.com`,
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  // Cascade order: delete brain → documents cascade; then company.
  // workflow_runs rows reference the document via FK restrict — delete them
  // first, then the document (which is deleted when the brain goes away).
  await db.delete(workflowRuns).where(eq(workflowRuns.workflowDocumentId, documentId));
  if (brainId) await db.delete(brains).where(eq(brains.id, brainId));
  if (companyId) await db.delete(companies).where(eq(companies.id, companyId));
  await client.end();
});

describe('workflow_runs: FK round-trip', () => {
  it('inserts and retrieves a workflow run', async () => {
    const [run] = await db
      .insert(workflowRuns)
      .values({
        workflowDocumentId: documentId,
        triggeredBy: testUserId,
        triggeredByKind: 'manual',
        status: 'running',
      })
      .returning();

    expect(run.id).toBeDefined();
    expect(run.status).toBe('running');
    expect(run.triggeredByKind).toBe('manual');
    expect(run.totalInputTokens).toBe(0);
    expect(run.totalOutputTokens).toBe(0);
    expect(run.totalCostUsd).toBe('0.000000');
    expect(run.outputDocumentIds).toEqual([]);
    expect(run.completedAt).toBeNull();
    expect(run.summary).toBeNull();
    expect(run.errorMessage).toBeNull();

    // Clean up immediately so afterAll cascade logic stays simple.
    await db.delete(workflowRuns).where(eq(workflowRuns.id, run.id));
  });
});

describe('workflow_run_events: sequence ordering + cascade', () => {
  let runId: string;

  beforeAll(async () => {
    const [run] = await db
      .insert(workflowRuns)
      .values({
        workflowDocumentId: documentId,
        triggeredBy: testUserId,
        status: 'running',
      })
      .returning({ id: workflowRuns.id });
    runId = run.id;

    // Insert two events out of insertion order to verify ORDER BY works.
    await db.insert(workflowRunEvents).values([
      {
        runId,
        sequence: 1,
        eventType: 'llm_delta',
        payload: { delta: 'hello' },
      },
      {
        runId,
        sequence: 0,
        eventType: 'turn_start',
        payload: { turnIndex: 0 },
      },
    ]);
  });

  it('returns events ordered by sequence ascending', async () => {
    const events = await db
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, runId))
      .orderBy(asc(workflowRunEvents.sequence));

    expect(events).toHaveLength(2);
    expect(events[0].sequence).toBe(0);
    expect(events[0].eventType).toBe('turn_start');
    expect(events[1].sequence).toBe(1);
    expect(events[1].eventType).toBe('llm_delta');
  });

  it('cascades event deletion when the parent run is deleted', async () => {
    await db.delete(workflowRuns).where(eq(workflowRuns.id, runId));

    const orphans = await db
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, runId));

    expect(orphans).toHaveLength(0);
  });
});

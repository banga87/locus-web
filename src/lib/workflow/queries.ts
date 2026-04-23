// Workflow DB query helpers — collocated with the workflow lib rather than
// src/db/queries/ (that directory does not exist; plan §4 Implementation Notes
// recommends colocation for workflow-related DB calls).
//
// Naming note: these helpers target the operational `workflow_runs` table,
// which keeps its name across the skill/workflow unification (the user-facing
// concept is "triggered skill" but the runs table is an internal artefact —
// see docs/superpowers/plans/2026-04-23-skill-workflow-unification.md).
//
// Consumers:
//   - POST /api/skills/runs              (createWorkflowRun, getSkillDocById)
//   - GET  /api/workflows/runs/[id]      (getWorkflowRunById)
//   - GET  /api/workflows/runs/[id]/events  (getRunEvents)
//   - POST /api/workflows/runs/[id]/cancel  (cancelWorkflowRun)
//   - GET  /api/cron/zombie-sweeper      (sweepZombies)

import { eq, gt, and, sql } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { workflowRunEvents } from '@/db/schema/workflow-run-events';

// ---------------------------------------------------------------------------
// Document queries
// ---------------------------------------------------------------------------

/**
 * Load a single document by id. Returns `null` if not found.
 * Used by the trigger route to check `type === 'skill'` and pull the
 * nested `metadata.trigger` block before inserting the run row.
 */
export async function getSkillDocById(id: string) {
  const [row] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Workflow run queries
// ---------------------------------------------------------------------------

/** Params for inserting a new workflow_run row. */
export interface CreateWorkflowRunParams {
  workflow_document_id: string;
  triggered_by: string;
  triggered_by_kind: 'manual' | 'schedule';
}

/**
 * Insert a new workflow_run row with `status='running'` (initial status per
 * spec Section 6 — no 'queued' state in v0). Returns the generated UUID.
 */
export async function createWorkflowRun(
  params: CreateWorkflowRunParams,
): Promise<string> {
  const [row] = await db
    .insert(workflowRuns)
    .values({
      workflowDocumentId: params.workflow_document_id,
      triggeredBy: params.triggered_by,
      triggeredByKind: params.triggered_by_kind,
      status: 'running',
    })
    .returning({ id: workflowRuns.id });

  if (!row) throw new Error('createWorkflowRun: insert returned no row');
  return row.id;
}

/**
 * Load a workflow_run row by id. Returns `null` if not found.
 *
 * The returned shape includes `companyId` joined through the owning
 * `documents` row — the workflow_runs table itself has no companyId
 * column. The ACL helper in `./access.ts` uses this field to enforce
 * tenant isolation on the read/cancel routes, which would otherwise
 * allow an owner/admin in Company A to read/cancel runs in Company B
 * if they guessed the run UUID.
 */
export async function getWorkflowRunById(runId: string) {
  const rows = await db
    .select({
      id: workflowRuns.id,
      workflowDocumentId: workflowRuns.workflowDocumentId,
      triggeredBy: workflowRuns.triggeredBy,
      triggeredByKind: workflowRuns.triggeredByKind,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
      outputDocumentIds: workflowRuns.outputDocumentIds,
      summary: workflowRuns.summary,
      errorMessage: workflowRuns.errorMessage,
      totalInputTokens: workflowRuns.totalInputTokens,
      totalOutputTokens: workflowRuns.totalOutputTokens,
      totalCostUsd: workflowRuns.totalCostUsd,
      createdAt: workflowRuns.createdAt,
      updatedAt: workflowRuns.updatedAt,
      // Denormalised from the owning document — needed for tenant isolation.
      companyId: documents.companyId,
    })
    .from(workflowRuns)
    .innerJoin(documents, eq(documents.id, workflowRuns.workflowDocumentId))
    .where(eq(workflowRuns.id, runId))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Event queries
// ---------------------------------------------------------------------------

/**
 * Return all events for a run ordered by sequence ascending.
 *
 * @param runId   The workflow run UUID.
 * @param after   Optional sequence number — only return events with
 *                sequence > after. Used by the UI on Realtime reconnect
 *                to fetch any events it missed (SWR re-fetch before the
 *                Realtime channel reattaches).
 */
export async function getRunEvents(runId: string, after?: number) {
  const conditions =
    after !== undefined
      ? and(
          eq(workflowRunEvents.runId, runId),
          gt(workflowRunEvents.sequence, after),
        )
      : eq(workflowRunEvents.runId, runId);

  return db
    .select()
    .from(workflowRunEvents)
    .where(conditions)
    .orderBy(workflowRunEvents.sequence);
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Atomically flip a run from `running` → `cancelled`.
 *
 * Returns the updated row so the caller can check if the update landed
 * (if no row is returned, the run was not in `running` state — it was
 * already in a terminal state and the cancel was a no-op).
 */
export async function cancelWorkflowRun(runId: string) {
  const nowSql = sql`now()`;
  const [updated] = await db
    .update(workflowRuns)
    .set({ status: 'cancelled', updatedAt: nowSql })
    .where(
      and(eq(workflowRuns.id, runId), eq(workflowRuns.status, 'running')),
    )
    .returning({ id: workflowRuns.id, status: workflowRuns.status });
  return updated ?? null;
}

// ---------------------------------------------------------------------------
// Zombie sweeper
// ---------------------------------------------------------------------------

export interface SweepZombiesParams {
  /** Runs inactive for this many minutes are promoted to 'failed'. */
  inactivityMinutes: number;
}

/**
 * Flip any workflow_run stuck in `running` with no activity for
 * `inactivityMinutes` minutes to `failed`.
 *
 * Returns the count of rows flipped.
 *
 * DB-clock discipline: uses `now()` and an interval expression so the
 * comparison is entirely on the DB clock — consistent with all status.ts
 * helpers which also write `updated_at = now()`.
 */
export async function sweepZombies(params: SweepZombiesParams): Promise<number> {
  const { inactivityMinutes } = params;
  // Multiplication form keeps `inactivityMinutes` parameterized —
  // `sql.raw(String(...))` would bypass parameter binding, which is safe
  // today (caller passes a literal 15) but becomes an injection point the
  // moment the signature takes dynamic input. This is defense in depth:
  // equivalent semantics, safer shape.
  const rows = await db
    .update(workflowRuns)
    .set({
      status: 'failed',
      errorMessage: 'Run exceeded inactivity window',
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(workflowRuns.status, 'running'),
        sql`${workflowRuns.updatedAt} < now() - (${inactivityMinutes} * interval '1 minute')`,
      ),
    )
    .returning({ id: workflowRuns.id });
  return rows.length;
}

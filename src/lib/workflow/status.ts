// Workflow run status helpers — one-liner Drizzle updates for each lifecycle
// transition.
//
// CRITICAL: every helper MUST set `updatedAt = now()`. The zombie sweeper
// (Task 6) reads `workflow_runs.updated_at` to detect stuck runs. There is
// no DB trigger to auto-bump this column — forgetting to set it causes false-
// positive zombie sweeps. See the JSDoc on workflowRuns.updatedAt.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { workflowRuns } from '@/db/schema/workflow-runs';

// ---------------------------------------------------------------------------
// Status transition helpers
// ---------------------------------------------------------------------------

/** Transition a run to `running`. Called at the top of runWorkflow. */
export async function markRunning(runId: string): Promise<void> {
  await db
    .update(workflowRuns)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(workflowRuns.id, runId));
}

interface CompletedParams {
  summary: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Accumulated cost in USD. Omit to leave at 0. */
  costUsd?: number;
}

/** Transition a run to `completed` with token counts and optional summary. */
export async function markCompleted(
  runId: string,
  params: CompletedParams,
): Promise<void> {
  await db
    .update(workflowRuns)
    .set({
      status: 'completed',
      summary: params.summary,
      totalInputTokens: params.inputTokens,
      totalOutputTokens: params.outputTokens,
      totalCostUsd: String(params.costUsd ?? 0),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workflowRuns.id, runId));
}

/** Transition a run to `failed` with an error message. */
export async function markFailed(
  runId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(workflowRuns)
    .set({
      status: 'failed',
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(workflowRuns.id, runId));
}

/** Transition a run to `cancelled`. */
export async function markCancelled(runId: string): Promise<void> {
  await db
    .update(workflowRuns)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(workflowRuns.id, runId));
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

type WorkflowRunStatus = typeof workflowRuns.$inferSelect['status'];

/**
 * Return the current status of a run, or `null` if the run doesn't exist.
 * Used by the runner at turn boundaries to detect cancellation.
 */
export async function getRunStatus(
  runId: string,
): Promise<WorkflowRunStatus | null> {
  const [row] = await db
    .select({ status: workflowRuns.status })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .limit(1);

  return row?.status ?? null;
}

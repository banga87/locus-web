// Workflow run event persistence.
//
// INVARIANT: Single-writer per run is load-bearing — the sequence counter is
// in-process. See spec Section 4 (workflow_run_events — Sequence generation).
// If multi-agent execution is ever added, either serialise event writes
// through the orchestrator or switch to a DB-side monotonic counter.

import { db } from '@/db';
import { workflowRunEvents } from '@/db/schema/workflow-run-events';
import type { workflowEventTypeEnum } from '@/db/schema/enums';
import type { InferSelectModel } from 'drizzle-orm';

// Derive the event type from the enum values defined in the schema.
type WorkflowEventType = InferSelectModel<typeof workflowRunEvents>['eventType'];

/**
 * Append one event to the workflow_run_events log.
 *
 * @param runId    UUID of the parent workflow_run row.
 * @param sequence Monotonically increasing counter within this run. The
 *                 caller (runTriggeredSkill) owns this counter — starts at 0 and
 *                 increments before each call. Single-writer invariant keeps
 *                 this safe without DB-side enforcement.
 * @param type     Event type. Must be a value in the workflowEventTypeEnum.
 * @param payload  Event-specific data. Shape varies by type; {} is valid for
 *                 events that carry no extra data (e.g. run_complete).
 */
export async function insertEvent(
  runId: string,
  sequence: number,
  type: WorkflowEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(workflowRunEvents).values({
    runId,
    sequence,
    eventType: type,
    payload,
  });
}

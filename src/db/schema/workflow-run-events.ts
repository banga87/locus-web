// Workflow run events — append-only streaming log for a workflow run.
//
// One row per event emitted during a run. Events are written by the
// runner in sequence order and consumed by the reattachable UI via
// Supabase Realtime (INSERT publication — see migration 0018).
//
// Design ref: locus-brain/implementation/phase-1.5-workflows.md §4.

import {
  pgTable,
  uuid,
  integer,
  jsonb,
  timestamp,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { workflowRuns } from './workflow-runs';

// All event types a run can emit.
export const workflowEventTypeEnum = pgEnum('workflow_event_type', [
  'turn_start',
  'llm_delta',
  'tool_start',
  'tool_result',
  'reasoning',
  'turn_complete',
  'run_error',
  'run_complete',
]);

export const workflowRunEvents = pgTable(
  'workflow_run_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Parent run. CASCADE: events are ephemeral — they go away if the run
    // is hard-deleted.
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),

    // Monotonically increasing counter within a run. Application-side
    // assignment — the runner increments its own counter before each insert.
    // Not enforced as UNIQUE at DB level because the runner is single-writer.
    sequence: integer('sequence').notNull(),

    eventType: workflowEventTypeEnum('event_type').notNull(),

    // Event-specific data. Shape is determined by event_type; see
    // src/lib/workflows/events.ts for per-type payload schemas.
    payload: jsonb('payload').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Primary read pattern: fetch all events for a run ordered by sequence.
    // Also used by Realtime channel filters on run_id.
    index('workflow_run_events_run_seq_idx').on(t.runId, t.sequence),
  ],
);

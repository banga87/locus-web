// Workflow run records — operational state for the Workflows feature.
//
// Each row represents one execution of a `type: workflow` document. These
// rows are NOT in `documents`: they are ephemeral operational state, not
// content. Their lifecycle is: created when a run starts, updated as it
// progresses, and retained for history/audit. Hard deletes are reserved
// for future retention-policy tooling.
//
// Design ref: locus-brain/implementation/phase-1.5-workflows.md §4.

import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { documents } from './documents';
import { users } from './users';
import { triggeredByKindEnum, workflowRunStatusEnum } from './enums';

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // The `type: workflow` document that defines this run's steps.
    workflowDocumentId: uuid('workflow_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),

    // The user who triggered the run.
    triggeredBy: uuid('triggered_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    triggeredByKind: triggeredByKindEnum('triggered_by_kind')
      .notNull()
      .default('manual'),

    status: workflowRunStatusEnum('status').notNull().default('running'),

    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Document IDs produced by this run (e.g. created/updated docs).
    // Single-writer invariant: only the runner for this run_id ever appends
    // to this array. No concurrent writers → no row-level locking needed.
    outputDocumentIds: uuid('output_document_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),

    // Human-readable summary generated at run completion.
    summary: text('summary'),

    // Error detail if status = 'failed'.
    errorMessage: text('error_message'),

    // Token + cost counters accumulated across all LLM calls in this run.
    totalInputTokens: integer('total_input_tokens').notNull().default(0),
    totalOutputTokens: integer('total_output_tokens').notNull().default(0),

    // Accumulated cost in USD. Stored as numeric for precision.
    totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Last write timestamp. IMPORTANT: the runner MUST explicitly set this on
     * every `UPDATE workflow_runs SET ...` — there is no DB trigger to
     * auto-bump it. The zombie sweeper (Task 6) reads `updated_at` to detect
     * stuck runs, so forgetting to bump it will cause false-positive zombie
     * sweeps.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Hot path: "show me all runs for this workflow, most recent first."
    index('workflow_runs_doc_started_idx').on(
      t.workflowDocumentId,
      t.startedAt,
    ),
    // Hot path: "show me all runs triggered by this user, most recent first."
    index('workflow_runs_user_started_idx').on(t.triggeredBy, t.startedAt),
  ],
);

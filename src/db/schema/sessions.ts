// Platform Agent chat sessions.
//
// Each chat conversation is one row. `session_turns` (in
// `./session-turns.ts`) holds the per-message history. Counters on this
// row are denormalised aggregates of the turn rows so the sidebar can
// render a session preview + token totals without scanning turns.
//
// Status is intentionally a two-state enum (`active` | `completed`).
// `paused` / `budget_exceeded` / etc. are deferred per the Phase 1
// simplification (§3.6 — "no pause/resume state machine").
//
// RLS: see `src/db/migrations/0004_sessions.sql`. The policy enforces
// company isolation AND per-user ownership — sessions are private even
// from other members of the same company.

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { brains } from './brains';
import { users } from './users';

export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'completed',
]);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    brainId: uuid('brain_id')
      .notNull()
      .references(() => brains.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    status: sessionStatusEnum('status').notNull().default('active'),

    // Denormalised counters. Updated atomically with each `session_turns`
    // insert via a transaction in `sessionManager.persistTurn`.
    turnCount: integer('turn_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),

    // Preview text for the sidebar list — first user message, truncated.
    firstMessage: text('first_message'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Bumped on every persistTurn + every resume. Indexed for the
    // sidebar's "most recent first" sort and for the cleanup cron.
    lastActiveAt: timestamp('last_active_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('sessions_user_last_active_idx').on(t.userId, t.lastActiveAt),
    index('sessions_status_last_active_idx').on(t.status, t.lastActiveAt),
  ],
);

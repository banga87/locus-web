// Inbox queue — Maintenance Agent decisions awaiting human review.
//
// Phase 1 ships only the schema; the Maintenance Agent (Phase 2) writes
// rows; the API + UI (Phase 3B) reads/decides them. The table is
// created here because every later phase needs the migration in place.
//
// Design notes:
//   - companyId + brainId are denormalised for cheap-tenant scoping
//     without joins; FKs cascade-delete from brain so cleanup is free.
//   - kind / status are TEXT with CHECK constraints (not pgEnum) so
//     adding a new kind in v1.5 is a CHECK alteration, not an enum
//     migration — pragmatic given the values are still settling.
//   - expires_at is set at insert time to created_at + 30d. The Phase
//     3B cron flips status='expired' once now() > expires_at.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { brains } from './brains';
import { documents } from './documents';

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    brainId: uuid('brain_id')
      .notNull()
      .references(() => brains.id, { onDelete: 'cascade' }),

    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    /** 'near_duplicate' | 'reclassification' | 'missing_field' */
    kind: text('kind').notNull(),

    /** Structured action the Maintenance Agent proposes. Shape varies
     *  per kind — Phase 2 will pin the schema. */
    proposedAction: jsonb('proposed_action').notNull().default({}),

    /** Cheap-pass context (e.g., { existing_doc_id, cosine,
     *  shared_topics } for near-duplicates). */
    context: jsonb('context').notNull().default({}),

    /** 'pending' | 'approved' | 'rejected' | 'modified' | 'expired' */
    status: text('status').notNull().default('pending'),

    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + INTERVAL '30 days'`),
  },
  (table) => [
    // DESC on createdAt matches the SQL DDL — Drizzle's `.on(...)`
    // defaults to ASC, so call `.desc()` explicitly.
    index('inbox_items_company_status_created_idx').on(
      table.companyId,
      table.status,
      table.createdAt.desc(),
    ),
  ],
);

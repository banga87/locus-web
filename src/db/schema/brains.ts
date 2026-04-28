// Knowledge-base container. One brain per company in Pre-MVP; the FK design
// is already multi-brain ready.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';

export const brains = pgTable(
  'brains',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    name: text('name').notNull(),

    // URL-safe slug used in MCP server endpoints.
    slug: varchar('slug', { length: 128 }).notNull(),

    description: text('description'),

    // Current brain version timestamp, bumped on any document change.
    // Agents use this for get_brain_diff(since=...).
    currentVersion: timestamp('current_version', { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Auto-computed health score (0-100). Updated by maintenance runs.
    healthScore: integer('health_score'),

    // Aggregate document count, kept denormalized for manifest generation.
    documentCount: integer('document_count').notNull().default(0),

    // Brain-level settings: maintenance schedule, default approval rules,
    // model routing preferences.
    settings: jsonb('settings').default({}),

    // Workspace topic vocabulary — { terms: [...], synonyms: {...},
    // version }. Seeded at brain provisioning (see
    // src/lib/taxonomy/seed.ts). v1 is fixed at 33 terms; admin
    // extension is out of scope.
    //
    // The default uses sql`'{}'::jsonb` to match the migration's
    // SQL DDL exactly. Drizzle's `default({})` for jsonb sometimes
    // emits parameterised empty objects instead of the SQL literal,
    // which can cause drizzle-kit drift on later introspection.
    topicVocabulary: jsonb('topic_vocabulary')
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('brains_company_id_idx').on(table.companyId)]
);

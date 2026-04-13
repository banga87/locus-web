// Per-brain document categories. Defines the top-level navigation structure
// of a brain (brand, pricing, processes, customers, etc.).

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { brains } from './brains';

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    brainId: uuid('brain_id')
      .notNull()
      .references(() => brains.id, { onDelete: 'cascade' }),

    // Machine-readable slug (e.g., "brand", "pricing", "processes").
    slug: varchar('slug', { length: 128 }).notNull(),

    name: text('name').notNull(),

    description: text('description'),

    // Display order in navigation.
    sortOrder: integer('sort_order').notNull().default(0),

    // Number of documents in this category (denormalized for manifest).
    documentCount: integer('document_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('categories_company_id_idx').on(table.companyId),
    index('categories_brain_id_idx').on(table.brainId),
    uniqueIndex('categories_brain_slug_idx').on(table.brainId, table.slug),
  ]
);

// Per-brain folders. Defines the navigable structure of a brain via a
// nestable hierarchy (parent_id self-FK). Top-level folders have a null
// parent and represent the root sections of the sidebar (brand, pricing,
// processes, customers, etc.); nested folders live underneath their
// parent. Slugs are unique per parent — i.e., two siblings cannot share
// the same slug, but the same slug may exist under different parents.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { brains } from './brains';

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    brainId: uuid('brain_id')
      .notNull()
      .references(() => brains.id, { onDelete: 'cascade' }),

    // Self-FK for nesting. Null = top-level folder. RESTRICT on delete so
    // we can't accidentally orphan/cascade a whole subtree — application
    // code walks children and prompts the user before deleting.
    parentId: uuid('parent_id').references(
      (): AnyPgColumn => folders.id,
      { onDelete: 'restrict' }
    ),

    // Machine-readable slug (e.g., "brand", "pricing", "processes").
    slug: varchar('slug', { length: 128 }).notNull(),

    name: text('name').notNull(),

    description: text('description'),

    // Display order in navigation.
    sortOrder: integer('sort_order').notNull().default(0),

    // Number of documents in this folder (denormalized for manifest).
    documentCount: integer('document_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('folders_company_id_idx').on(table.companyId),
    index('folders_brain_id_idx').on(table.brainId),
    index('folders_parent_id_idx').on(table.parentId),
    // Two partial unique indexes enforce sibling-unique slugs while
    // letting the same slug appear under different parents (and at the
    // root). Postgres treats NULL as distinct in regular unique indexes,
    // which is why we split the top-level case into its own partial.
    uniqueIndex('folders_top_slug_idx')
      .on(table.brainId, table.slug)
      .where(sql`"parent_id" IS NULL`),
    uniqueIndex('folders_nested_slug_idx')
      .on(table.parentId, table.slug)
      .where(sql`"parent_id" IS NOT NULL`),
  ]
);

// Temporary alias so unconverted consumers keep compiling during the refactor.
// Removed in Task 11 once the last import is migrated.
export const categories = folders;

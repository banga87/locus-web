// Root multi-tenant entity. Every company-scoped row transitively joins here.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  jsonb,
} from 'drizzle-orm/pg-core';

export const companies = pgTable('companies', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Display name shown in dashboard and manifests.
  name: text('name').notNull(),

  // URL-safe slug; used in MCP server identity (e.g., "acme-corp").
  slug: varchar('slug', { length: 128 }).notNull().unique(),

  // Billing tier: starter | pro | business | enterprise.
  tier: varchar('tier', { length: 32 }).notNull().default('starter'),

  // Industry vertical for template recommendations.
  industry: varchar('industry', { length: 128 }),

  // Flexible settings: timezone, notification prefs, feature flags.
  settings: jsonb('settings').default({}),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

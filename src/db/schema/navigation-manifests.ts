// Pre-computed navigation manifest served to agents via get_manifest.
// Regenerated on every brain content change; retaining prior versions
// supports brain-diff computation.

import {
  pgTable,
  uuid,
  timestamp,
  jsonb,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { brains } from './brains';

export const navigationManifests = pgTable(
  'navigation_manifests',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    brainId: uuid('brain_id')
      .notNull()
      .references(() => brains.id, { onDelete: 'cascade' }),

    // Full manifest content as JSONB. Structure matches the
    // get_manifest response format from the agent-integration spec.
    content: jsonb('content').notNull(),

    // Manifest version timestamp. Matches brains.current_version at
    // generation time.
    version: timestamp('version', { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Whether this is the currently active manifest.
    isCurrent: boolean('is_current').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('nav_manifests_company_id_idx').on(table.companyId),
    index('nav_manifests_brain_current_idx').on(
      table.brainId,
      table.isCurrent
    ),
  ]
);

// Skill manifest cache — one row per company.
//
// The authoritative data for skills lives in `documents` rows where
// `type = 'skill'`. Rebuilding the matcher-ready representation on
// every chat turn would re-parse every skill doc's YAML frontmatter;
// instead the per-company manifest is compiled once and cached here
// as JSON. The matcher reads this row, never the skill docs directly.
//
// Rebuild trigger: application code schedules a rebuild on any
// INSERT/UPDATE/DELETE of a skill doc (debounced ≤1 rebuild / 5s per
// company). Rebuild failure keeps the previous manifest in place.
//
// RLS: see `src/db/migrations/0007_agents_ingestion.sql`. Single
// company-isolation policy using the `get_user_company_id()` helper
// so authenticated users can SELECT their company's manifest but see
// nothing else. Server-side rebuilds use the service role (bypasses
// RLS) and scope explicitly by company_id.

import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const skillManifests = pgTable('skill_manifests', {
  // PK on companyId: exactly one manifest per company. Rebuilds upsert.
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id, { onDelete: 'cascade' }),

  // The compiled manifest JSON. Shape is documented in the Phase 1.5
  // design spec §Skill manifest (cache) — { version, built_at, skills[] }
  // where each skill entry carries id/slug/title/description/priority/
  // minScore/triggers/bodyDocId/bodyBytes. Body content is loaded from
  // the referenced `documents` row only when a skill matches.
  manifest: jsonb('manifest').notNull(),

  // Bumped on every successful rebuild. Matches the `built_at` field
  // embedded inside `manifest` for convenience in cache-invalidation
  // queries without parsing the JSON.
  builtAt: timestamp('built_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

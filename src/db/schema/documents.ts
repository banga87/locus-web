// Brain documents — the core content entity.
//
// Pre-MVP knowledge-architecture fields: status, ownerId (FK -> users),
// confidenceLevel (enum), isCore (boolean). These are the minimum required
// for Phase 0 features; the richer Phase 2 fields (layer, pack,
// document_type, aliases, review_cycle_days, next_review_at,
// confidence_score numeric) are intentionally deferred.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { brains } from './brains';
import { folders } from './folders';
import { users } from './users';
import { documentStatusEnum, confidenceLevelEnum } from './enums';

// Drizzle has no native tsvector. The column is written only by the
// `documents_search_vector_trigger` Postgres trigger (migration 0002); we
// just need Drizzle to emit a `tsvector` column type for reads.
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    brainId: uuid('brain_id')
      .notNull()
      .references(() => brains.id, { onDelete: 'cascade' }),

    folderId: uuid('folder_id').references(() => folders.id, {
      onDelete: 'set null',
    }),

    title: text('title').notNull(),

    // URL-safe slug, unique within a brain (e.g., "brand-voice-guide").
    slug: varchar('slug', { length: 256 }).notNull(),

    // Denormalized "{category_slug}/{document_slug}" for MCP tool-call
    // lookups without joins.
    path: varchar('path', { length: 512 }).notNull(),

    // Authoritative Markdown content. Served by read_document as-is.
    content: text('content').notNull().default(''),

    summary: text('summary'),

    // Denormalised document type, mirrored from the YAML frontmatter
    // `type:` field on every write (see src/lib/brain/save.ts). Powers
    // indexed lookups for manifest rebuilds and agent-scaffolding
    // lookups without parsing content. Nullable for backward compat
    // with pre-Phase-1.5 rows until `scripts/backfill-document-type.ts`
    // runs.
    //
    // Three reserved values branch in application code:
    //   - 'agent-scaffolding' (partial-unique: at most one per company)
    //   - 'agent-definition'
    //   - 'skill'
    // Any other value is treated as plain knowledge.
    type: text('type'),

    // --- Phase 0 knowledge-architecture fields ---------------------------

    // Lifecycle state. Agents filter by status='active' for public reads.
    status: documentStatusEnum('status').notNull().default('draft'),

    // Document owner — receives approval requests, acts as the human
    // point-of-contact. Nullable; owners can leave companies.
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Discrete confidence level shown in UI and agent responses.
    // (Continuous numeric confidence_score is a Phase 2 field.)
    confidenceLevel: confidenceLevelEnum('confidence_level')
      .notNull()
      .default('medium'),

    // "Core" documents anchor the brain — foundational docs like mission,
    // brand voice, or pricing. Agents treat them as authoritative context.
    isCore: boolean('is_core').notNull().default(false),

    // Pinning: brain-scoped boolean surfaced in the sidebar's Pinned
    // section. Cheap to query via partial index `documents_brain_pinned_idx`.
    isPinned: boolean('is_pinned').notNull().default(false),

    // ---------------------------------------------------------------------

    // Estimated token count for this document. Pre-computed on save so
    // manifests can report size without reading content.
    tokenEstimate: integer('token_estimate').default(0),

    // Version number, incremented on each content change. Matches the
    // versionNumber written to `document_versions` on save.
    version: integer('version').notNull().default(1),

    // Verification tracking.
    verifiedBy: text('verified_by'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),

    // Tags for search and manifest filtering.
    tags: jsonb('tags').default([]),

    // Related document IDs for get_document_context.
    relatedDocuments: jsonb('related_documents').default([]),

    // Structured frontmatter catch-all (applies_to, changelog, supersedes).
    metadata: jsonb('metadata').default({}),

    // Full-text search vector. Written only by the Postgres trigger;
    // application code never mutates this column directly.
    searchVector: tsvector('search_vector'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('documents_company_id_idx').on(table.companyId),
    index('documents_brain_id_idx').on(table.brainId),
    index('documents_folder_id_idx').on(table.folderId),
    index('documents_brain_path_idx').on(table.brainId, table.path),
    index('documents_brain_status_idx').on(table.brainId, table.status),
    index('documents_brain_is_core_idx').on(table.brainId, table.isCore),
    // Partial index supports the sidebar's Pinned section query:
    // SELECT ... WHERE brain_id = $1 AND is_pinned = true.
    index('documents_brain_pinned_idx')
      .on(table.brainId, table.isPinned)
      .where(sql`"is_pinned" = true`),
    index('documents_owner_id_idx').on(table.ownerId),
    index('documents_deleted_at_idx').on(table.deletedAt),
    // GIN index backs the search_brain tool's tsvector lookups.
    index('documents_search_vector_idx').using('gin', table.searchVector),
    // Manifest-rebuild hot path: SELECT ... WHERE company_id = $1 AND type = $2.
    index('documents_company_type_idx').on(table.companyId, table.type),
    // Partial unique index: at most one agent-scaffolding doc per company.
    uniqueIndex('documents_company_scaffolding_unique')
      .on(table.companyId)
      .where(sql`${table.type} = 'agent-scaffolding'`),
  ]
);

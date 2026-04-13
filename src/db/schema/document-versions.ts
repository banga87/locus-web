// Immutable version history. Every content change to a document creates
// a new row here. Rows are never updated or deleted — enforced by a
// Postgres trigger added in migration 0003.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { documents } from './documents';

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    // Sequential version number matching documents.version at save time.
    versionNumber: integer('version_number').notNull(),

    // Full document content at this version.
    content: text('content').notNull(),

    // Human-readable summary of what changed.
    changeSummary: text('change_summary'),

    // Who made the change: user id, agent token id, or "system".
    changedBy: text('changed_by').notNull(),

    // Actor type for audit correlation. Matches actor_type enum values
    // (stored as text here to decouple from the enum's migration lifecycle).
    changedByType: text('changed_by_type').notNull().default('human'),

    // Snapshot of document metadata at this version (title, confidence,
    // tags, etc.) for faithful reconstruction without joining back.
    metadataSnapshot: jsonb('metadata_snapshot').default({}),

    // If this version was created by approving a DCP, link to it.
    // FK not enforced — the proposals table ships in MVP.
    proposalId: uuid('proposal_id'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('doc_versions_company_id_idx').on(table.companyId),
    index('doc_versions_document_id_idx').on(table.documentId),
    index('doc_versions_document_version_idx').on(
      table.documentId,
      table.versionNumber
    ),
  ]
);

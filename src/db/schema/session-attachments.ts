// Session attachments — user-uploaded files and pasted-text blobs
// that flow through the Phase 1.5 ingestion state machine.
//
// Lifecycle (see design spec §Ingestion Flow):
//
//   uploaded → (extraction) → extracted
//            → (agent dialog + user approval)
//              → committed  (becomes / attaches to a brain document)
//              → discarded  (dropped; storage purged by cron ≥7 days later)
//
// `kind` and `status` are CHECK-constrained text columns rather than
// pg_enum types because the vocabularies are tightly coupled to the
// TypeScript state machine — keeping them as CHECKs avoids pg_enum
// ALTER TYPE churn when the state machine grows. The enum-like helpers
// below give TypeScript call sites the same type safety an enum would.
//
// RLS: see `src/db/migrations/0007_agents_ingestion.sql`. Single
// company-isolation policy using `get_user_company_id()`. The session
// owner's boundary is enforced by the parent `sessions` policy
// transitively (attachments that reference a session the caller can't
// see aren't reachable anyway, but the company_id column gives us a
// direct index for the status-cleanup cron).

import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { sessions } from './sessions';
import { documents } from './documents';

// TypeScript-side vocabularies. The SQL CHECK constraints in migration
// 0007 pin the same values on the DB side.
export type SessionAttachmentKind = 'file' | 'pasted-text';
export type SessionAttachmentStatus =
  | 'uploaded'
  | 'extracted'
  | 'committed'
  | 'discarded';

export const sessionAttachments = pgTable(
  'session_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),

    // 'file' (a real upload in Supabase Storage) or 'pasted-text' (the
    // user dropped text directly into the chat). CHECK constraint on
    // the SQL side; this column is a plain text so we don't drag an
    // enum through migrations.
    kind: text('kind').$type<SessionAttachmentKind>().notNull(),

    // Supabase Storage path for file-kind uploads. NULL for
    // pasted-text. Format: attachments/{company_id}/{session_id}/{id}.
    storageKey: text('storage_key'),
    filename: text('filename'),
    mimeType: text('mime_type'),
    // bigint so we don't truncate attachments >2 GB. Returned as a
    // string by the postgres-js driver; callers parse as needed.
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }),

    // Populated by the extraction worker on transition to 'extracted'.
    // NULL until then.
    extractedText: text('extracted_text'),
    extractionError: text('extraction_error'),

    // See SessionAttachmentStatus for the vocabulary.
    status: text('status').$type<SessionAttachmentStatus>().notNull(),

    // When an attachment is 'committed', this points at the brain
    // document it created / attached to. SET NULL on doc delete so the
    // attachment audit trail survives archive/cleanup.
    committedDocId: uuid('committed_doc_id').references(() => documents.id, {
      onDelete: 'set null',
    }),

    // Last session turn index that inlined this attachment's content
    // into the prompt. Used by the deduplication logic in the
    // UserPromptSubmit handler to avoid re-inlining the same content.
    injectedAtTurn: integer('injected_at_turn'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Listing all attachments for a given session (UI + dedup lookups).
    index('session_attachments_session_id_idx').on(t.sessionId),
    // Status-cleanup cron: "find stuck uploads older than 1h" hits
    // (company_id, status) first for the company scope, then scans.
    index('session_attachments_status_idx').on(t.companyId, t.status),
  ],
);

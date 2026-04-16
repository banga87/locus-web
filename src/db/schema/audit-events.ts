// Append-only audit log. No foreign keys: audit events must survive even
// if the referenced row is deleted or corrupted. UPDATE/DELETE are blocked
// by a Postgres trigger installed in migration 0003.
//
// Pre-MVP only emits `document_access` and `authentication` events, but the
// schema supports the full category set so new events don't require a
// schema change.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { auditEventCategoryEnum, actorTypeEnum } from './enums';

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Denormalized tenant reference. No FK by design — see file header.
    companyId: uuid('company_id').notNull(),

    category: auditEventCategoryEnum('category').notNull(),

    // Specific event type, e.g. "document.read", "auth.login".
    eventType: varchar('event_type', { length: 128 }).notNull(),

    actorType: actorTypeEnum('actor_type').notNull(),
    // actorId is text (not uuid) so it can hold user uuids, agent-token
    // uuids, or the literal "system".
    actorId: text('actor_id').notNull(),
    actorName: text('actor_name'),

    // What was acted upon.
    targetType: varchar('target_type', { length: 64 }),
    targetId: text('target_id'),

    // Flexible event-specific payload.
    details: jsonb('details').default({}),

    // Caller IP for user-driven events.
    ipAddress: varchar('ip_address', { length: 45 }),

    // Originating session or token (denormalized; no FK).
    sessionId: uuid('session_id'),
    tokenId: uuid('token_id'),
    // 'pat' | 'oauth' | null. null for non-token actors.
    tokenType: text('token_type'),

    // Brain-scope for events that target brain-scoped entities.
    // Nullable: authentication / administration events aren't brain-scoped.
    // ON DELETE SET NULL is enforced at the DB level (migration 0013).
    brainId: uuid('brain_id'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Indexing matches 07-audit-logging.md "Indexing Strategy". Every
    // composite leads with company_id so queries benefit from
    // tenant-scoped index pruning — mirrors the RLS policy shape.
    index('audit_events_company_id_idx').on(table.companyId),
    index('audit_events_category_idx').on(table.companyId, table.category),
    index('audit_events_event_type_idx').on(
      table.companyId,
      table.eventType
    ),
    index('audit_events_actor_idx').on(table.companyId, table.actorId),
    index('audit_events_target_idx').on(
      table.companyId,
      table.targetType,
      table.targetId
    ),
    index('audit_events_created_at_idx').on(
      table.companyId,
      table.createdAt
    ),
  ]
);

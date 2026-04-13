// Tokens for external agents connecting via MCP.
//
// Pre-MVP scope: scopes default to ['read']; rate-limit columns
// (requestsPerMinute, dailyTokenLimit) are deferred to Phase 2.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { agentTokenStatusEnum } from './enums';

export const agentAccessTokens = pgTable(
  'agent_access_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),

    // Human-readable label (e.g., "Marketing Claude", "Sales GPT").
    name: text('name').notNull(),

    // SHA-256 hash of the raw token. The raw token is shown once at
    // creation and never stored. Format: "lat_" prefix + random bytes.
    tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),

    // First 12 characters of the raw token, e.g. "lat_live_a1b".
    // Used for identification in UI/logs without exposing the secret.
    tokenPrefix: varchar('token_prefix', { length: 16 }).notNull(),

    // Scoped permissions. Format: "action:resource_type:resource_ids",
    // e.g. "read:categories:brand,pricing". Empty array = no access.
    // Pre-MVP default ['read'] grants read-all-categories.
    scopes: text('scopes').array().notNull().default(['read']),

    // Lifecycle status. Overlaps with `revokedAt` — keeping both because
    // `status` is what the hot-path auth check reads.
    status: agentTokenStatusEnum('status').notNull().default('active'),

    // Usage tracking.
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    totalRequests: integer('total_requests').notNull().default(0),

    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    // Who created this token.
    createdBy: uuid('created_by'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('agent_tokens_company_id_idx').on(table.companyId),
    index('agent_tokens_hash_idx').on(table.tokenHash),
    index('agent_tokens_status_idx').on(table.companyId, table.status),
  ]
);

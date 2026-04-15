// Registered MCP clients from Dynamic Client Registration (RFC 7591).
// Public clients only — no client_secret. A client_id is not owned
// by any user; many users can share the same client_id and each gets
// their own per-user refresh tokens.

import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const oauthClients = pgTable('oauth_clients', {
  clientId: uuid('client_id').defaultRandom().primaryKey(),
  clientName: text('client_name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  grantTypes: text('grant_types')
    .array()
    .notNull()
    .default(['authorization_code', 'refresh_token']),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

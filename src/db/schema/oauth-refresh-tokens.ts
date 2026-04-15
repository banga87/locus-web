// Long-lived refresh tokens, rotated on use. token_hash is the PK.
// revoked_at set on rotation or explicit disconnect. Rotation-reuse
// detection: presenting a revoked token chain-revokes all rows for
// the same (user_id, client_id).

import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-clients';
import { users } from './users';
import { companies } from './companies';

export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    index('oauth_refresh_user_client_active_idx').on(t.userId, t.clientId),
  ],
);

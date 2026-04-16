// In-flight auth sessions — lives between GET /api/oauth/authorize
// and POST /api/oauth/authorize/approve|deny. 5-minute TTL.

import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { oauthClients } from './oauth-clients';

export const oauthSessions = pgTable(
  'oauth_sessions',
  {
    sessionRef: text('session_ref').primaryKey(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    state: text('state'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('oauth_sessions_expires_at_idx').on(t.expiresAt)],
);

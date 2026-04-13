// MCP OUT connection records — external MCP servers the Platform Agent
// connects to per company (Gmail, HubSpot, Xero, Google Analytics, etc.).
//
// One row = one connection. On every chat turn, `loadMcpOutTools()`
// reads the `active` rows for the calling company, opens a client
// transport against each, calls `listTools()`, and wraps every tool as
// an AI SDK `dynamicTool` added to the Platform Agent's tool set.
//
// Auth is intentionally minimal for MVP: only "no auth" or "paste a
// bearer token." The bearer token is stored encrypted via pgcrypto with
// a key in env (`MCP_CONNECTION_ENCRYPTION_KEY`). OAuth per provider and
// Supabase Vault integration are explicit Phase 2 concerns.
//
// Status values:
//   - 'active'   — considered on every chat turn; tools are discovered
//   - 'disabled' — user has paused the connection; skipped silently
//   - 'error'    — last connection attempt failed; `lastErrorMessage`
//                  explains why. Still skipped on chat turns (only
//                  `active` is loaded) but visible in the settings UI so
//                  the user can fix and re-test.
//
// RLS: see `src/db/migrations/0005_mcp_connections.sql`. Company
// isolation mirrors the standard `company_isolation` policy pattern —
// any member of the company can see and manage connections, but the
// API routes further restrict mutations to the Owner role.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  customType,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const mcpConnectionAuthTypeEnum = pgEnum('mcp_connection_auth_type', [
  'none',
  'bearer',
]);

export const mcpConnectionStatusEnum = pgEnum('mcp_connection_status', [
  'active',
  'disabled',
  'error',
]);

// pgcrypto's pgp_sym_encrypt returns bytea. Drizzle lacks a first-class
// bytea column type, so we define one via `customType`. The `postgres`
// driver (v3.x) returns a Node `Buffer` for bytea values out of the box,
// which matches the declared `data` / `driverData` types.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const mcpConnections = pgTable(
  'mcp_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    serverUrl: text('server_url').notNull(),
    authType: mcpConnectionAuthTypeEnum('auth_type')
      .notNull()
      .default('none'),
    // Nullable because `authType = 'none'` connections carry no secret.
    credentialsEncrypted: bytea('credentials_encrypted'),
    status: mcpConnectionStatusEnum('status').notNull().default('active'),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    // Hot path: `loadMcpOutTools()` selects by (company_id, status='active')
    // on every chat turn.
    index('mcp_connections_company_status_idx').on(t.companyId, t.status),
  ],
);

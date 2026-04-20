// Per-interaction token and cost records. Schema is load-bearing even in
// Pre-MVP (empty in practice) — downstream billing, usage dashboards, and
// observability all read from this shape.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const usageRecords = pgTable(
  'usage_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    // Who triggered this usage. All three nullable to support the
    // different sources: users use sessions, MCP uses token, system/
    // maintenance leaves all null.
    userId: uuid('user_id'),
    tokenId: uuid('token_id'),
    sessionId: uuid('session_id'),

    // Model/provider (NULL for MCP tool calls where Locus does not host
    // the model).
    model: text('model'),
    provider: text('provider'),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),

    // What Locus pays the LLM provider.
    providerCostUsd: real('provider_cost_usd').notNull().default(0),
    // What Locus charges the customer (includes markup per ADR-003).
    customerCostUsd: real('customer_cost_usd').notNull().default(0),

    // 'platform_agent' | 'maintenance_agent' | 'mcp' | 'system'.
    source: text('source').notNull(),

    metadata: jsonb('metadata').default({}),

    // FK to the parent LLM call's usage_records row. NULL for Platform Agent
    // / top-level calls; populated for subagent invocations. Enables
    // attribution queries summing parent + child token spend for a single
    // conversational turn. See 2026-04-19 subagent harness spec §7.
    parentUsageRecordId: uuid('parent_usage_record_id'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('usage_records_company_id_idx').on(table.companyId),
    index('usage_records_user_id_idx').on(table.userId),
    index('usage_records_created_at_idx').on(
      table.companyId,
      table.createdAt
    ),
    index('usage_records_parent_usage_record_id_idx').on(
      table.parentUsageRecordId
    ),
  ]
);

// Shared Postgres enums used across multiple schema files.
//
// Pre-MVP scope only. New enums are added per the design doc
// (12-database-schema.md) as tables are introduced in later phases.

import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'owner',
  'admin',
  'editor',
  'viewer',
]);

export const userStatusEnum = pgEnum('user_status', [
  'invited',
  'active',
  'deactivated',
]);

// Actor classification for audit events.
// `agent_token` = external MCP agent; `platform_agent` = our hosted Platform
// Agent; `maintenance_agent` = our background Maintenance Agent; `system`
// = unattended operations (e.g. manifest regeneration); `human` = end user.
export const actorTypeEnum = pgEnum('actor_type', [
  'human',
  'agent_token',
  'platform_agent',
  'maintenance_agent',
  'system',
]);

export const documentStatusEnum = pgEnum('document_status', [
  'draft',
  'active',
  'archived',
]);

export const confidenceLevelEnum = pgEnum('confidence_level', [
  'high',
  'medium',
  'low',
]);

// Audit event category matches 07-audit-logging.md. Pre-MVP only emits
// `document_access` and `authentication` events; the full set is declared
// up front so new categories don't require an enum-altering migration.
export const auditEventCategoryEnum = pgEnum('audit_event_category', [
  'document_access',
  'document_mutation',
  'proposal',
  'confidence',
  'authentication',
  'maintenance',
  'administration',
  'token_usage',
]);

// Agent access token lifecycle states. In Pre-MVP we only use `active` and
// `revoked`; `expired` is reserved for when a scheduled job sweeps tokens
// past their `expiresAt`.
export const agentTokenStatusEnum = pgEnum('agent_token_status', [
  'active',
  'revoked',
  'expired',
]);

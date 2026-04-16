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
  'mcp_invocation',
]);

// Agent access token lifecycle states. In Pre-MVP we only use `active` and
// `revoked`; `expired` is reserved for when a scheduled job sweeps tokens
// past their `expiresAt`.
export const agentTokenStatusEnum = pgEnum('agent_token_status', [
  'active',
  'revoked',
  'expired',
]);

// --- Workflow run enums (Phase 1.5) ----------------------------------------

// How a workflow run was initiated. 'schedule' is reserved for Phase 2 cron
// triggers.
export const triggeredByKindEnum = pgEnum('triggered_by_kind', [
  'manual',
  'schedule',
]);

// Lifecycle status of a workflow run.
// 'queued' is reserved for future queueing support; initial inserts use
// 'running' directly (preflight passes → start immediately).
export const workflowRunStatusEnum = pgEnum('workflow_run_status', [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

// All event types a workflow run can emit over its lifetime.
export const workflowEventTypeEnum = pgEnum('workflow_event_type', [
  'turn_start',
  'llm_delta',
  'tool_start',
  'tool_result',
  'reasoning',
  'turn_complete',
  'run_error',
  'run_complete',
]);

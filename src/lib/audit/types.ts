// Audit event types. Mirrors the `audit_events` table shape defined in
// `src/db/schema/audit-events.ts`, which is the source of truth.
//
// Pre-MVP note: callers only emit `document_access` and `authentication`
// events today, but the union types accept the full set so the table
// schema and this type stay aligned. `traceId` is intentionally omitted —
// OpenTelemetry correlation is a Phase 2 concern.

/**
 * Actor classification. Must match the `actor_type` pgEnum in the DB.
 */
export type ActorType =
  | 'human'
  | 'agent_token'
  | 'platform_agent'
  | 'maintenance_agent'
  | 'system';

/**
 * What an event acted upon. Free-form string in the DB (`varchar(64)`)
 * but constrained to this set by convention.
 */
export type TargetType =
  | 'document'
  | 'folder'
  | 'proposal'
  | 'session'
  | 'connection'
  | 'brain'
  | 'user';

/**
 * Event category. Must match the `audit_event_category` pgEnum.
 */
export type AuditEventCategory =
  | 'document_access'
  | 'document_mutation'
  | 'proposal'
  | 'confidence'
  | 'authentication'
  | 'maintenance'
  | 'administration'
  | 'token_usage'
  | 'mcp_invocation';

/**
 * Shape of an event passed to `logEvent()`. Field names match the Drizzle
 * schema (camelCase), which maps to snake_case columns in Postgres.
 *
 * `_capturedAt` is set inside `logEvent()` — callers must not supply it.
 */
export interface AuditEvent {
  // Required
  companyId: string;
  category: AuditEventCategory;
  eventType: string;
  actorType: ActorType;
  actorId: string;

  // Optional
  actorName?: string;
  targetType?: TargetType;
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  sessionId?: string;
  tokenId?: string;

  // Populated by the logger at call time. Not part of the public call
  // surface — callers should not set this.
  _capturedAt?: Date;
}

// Tool Executor type definitions.
//
// Source of truth: design/agent-harness/02-tool-executor.md "The LocusTool
// Interface". Pre-MVP slices off anything that depends on components we
// haven't shipped yet:
//
//   - `sessionId` / `tokenId` / `traceId` / `abortSignal` live on
//     ToolContext but are optional. Only `tokenId` gets populated today
//     (by the MCP server in Task 8); the rest land in Phase 1 alongside
//     the Platform Agent + OTel wiring.
//   - `requiresApproval()` and `confidenceImpact()` from the doc are NOT
//     on the interface yet — they're write-tool concerns, and Pre-MVP
//     ships read tools only. Phase 1 adds them when write tools land.
//
// Keep this file import-light: it is imported by every tool implementation
// and by both the MCP server and the Platform Agent.

import type { JSONSchemaType, SchemaObject } from 'ajv';
import type { ActorType, AuditEvent } from '@/lib/audit/types';

/**
 * JSON Schema passed to ajv. Accepts either a typed schema (for compile-time
 * safety on tool input shapes) or the generic `SchemaObject` (for cases where
 * the schema is built dynamically).
 */
export type ToolInputSchema = SchemaObject | JSONSchemaType<unknown>;

/**
 * Who is making the call. Resolved by the API route layer (Layer 1 of the
 * permission chain) before the executor ever runs. The executor treats
 * this as immutable.
 *
 * `scopes` mirrors the token scopes in the DB. Pre-MVP only issues `read`.
 */
export interface Actor {
  /**
   * MUST match the `actor_type` pgEnum. For MCP callers this is
   * `'agent_token'` (never `'agent'`).
   */
  type: ActorType;
  /** User id for humans, token id for agent tokens, component id for system. */
  id: string;
  /** Display name for audit rows. Optional. */
  name?: string;
  /** Scopes granted to this actor. Pre-MVP: `['read']`. */
  scopes: string[];
}

/**
 * Fully assembled request context. Passed into every `tool.call()` and
 * into `executeTool()`. The executor never mutates this.
 */
export interface ToolContext {
  actor: Actor;
  companyId: string;
  brainId: string;

  /** Platform Agent session. Absent for MCP. Phase 1 concern. */
  sessionId?: string;
  /** MCP token id. Absent for Platform Agent. */
  tokenId?: string;
  /** OTel trace id. Phase 2 concern. */
  traceId?: string;
  /** Cancellation propagation. Phase 1 concern. */
  abortSignal?: AbortSignal;
  /**
   * Capability labels the caller has been granted. Derived by the route
   * layer from actor + agent-definition. Platform Agent default: ['web'].
   */
  grantedCapabilities: string[];
  /**
   * Running count of web_search + web_fetch calls in the current turn.
   * The route layer initialises to 0 at turn start; web_* tools read and
   * increment. Used to enforce the 15-call safety rail.
   */
  webCallsThisTurn: number;
}

/**
 * Structured error returned inside a failed `ToolResult`. Shape mirrors
 * 02-tool-executor.md §"The LocusTool Interface" exactly.
 */
export interface ToolError {
  /**
   * Stable error code. The doc uses these today:
   *   - `invalid_input`        — ajv validation failed
   *   - `unknown_tool`         — no tool registered with that name
   *   - `scope_denied`         — actor lacks the required scope
   *   - `permission_denied`    — future: fine-grained ACL denial
   *   - `document_not_found`   — tool-level lookup miss
   *   - `execution_error`      — unexpected throw from `tool.call()`
   *   - `rate_limited`         — future: MCP rate-limit layer
   *
   * Additional codes may be minted by individual tools.
   */
  code: string;
  message: string;
  /** Per-field validation hints from ajv, or fuzzy-match suggestions. */
  suggestions?: string[];
  /** Exhaustive list of valid section names returned with `section_not_found`. */
  available_sections?: string[];
  /** Free-form actionable hint for the agent consuming this error. */
  hint?: string;
  /** Whether the caller may retry without changing inputs. */
  retryable: boolean;
  /** Seconds. Populated for `rate_limited` and `brain_locked`. */
  retryAfter?: number;
}

/**
 * Uniform result envelope. `success: true` → `data` populated, `error`
 * absent. `success: false` → `error` populated, `data` absent. `metadata`
 * is always present (even on error) so callers can surface execution cost.
 */
export interface ToolResult<O = unknown> {
  success: boolean;
  data?: O;
  error?: ToolError;
  metadata: ToolResultMetadata;
}

export interface ToolResultMetadata {
  /** Estimated token count of the response body (ceil(length / 4)). */
  responseTokens: number;
  /** Wall-clock execution time in milliseconds. */
  executionMs: number;
  /** Document ids touched during execution. Empty array is valid. */
  documentsAccessed: string[];
  /** Free-form tool-specific details merged into the audit event. */
  details?: Record<string, unknown>;
}

/**
 * The contract every brain tool implements. The executor drives this
 * interface — individual tools never need to know about audit, validation,
 * or permission plumbing.
 */
export interface LocusTool<I = unknown, O = unknown> {
  /** Stable tool name. Used in MCP registration and audit logs. */
  readonly name: string;
  /** Human-facing description. Shown to LLMs in system prompts. */
  readonly description: string;
  /** JSON Schema for ajv validation. Pre-compiled at registration. */
  readonly inputSchema: ToolInputSchema;
  /**
   * Capability labels this tool requires on the caller's context. Absent
   * or empty = universal (every caller may invoke). buildToolSet filters
   * tools whose required capabilities aren't satisfied by the current
   * ToolContext.grantedCapabilities.
   *
   * Known labels (v1):
   *   - 'web'   — web_search + web_fetch declare this
   */
  readonly capabilities?: string[];

  /** True if the tool does not modify brain state. */
  isReadOnly(): boolean;

  /**
   * Execute the tool with validated input. The executor calls this only
   * after input validation and permission checks have passed.
   */
  call(input: I, context: ToolContext): Promise<ToolResult<O>>;
}

/**
 * What a tool contributes to its audit event. The executor fills in
 * companyId, actorType, actorId, sessionId, tokenId — the tool only
 * needs to specify the domain-specific fields (category, eventType,
 * targetType, targetId, details).
 *
 * Not currently used by Pre-MVP tools — the executor generates audit
 * events directly from `ToolResult.metadata`. Kept here for Phase 1
 * when per-tool audit customization becomes necessary.
 */
export type ToolAuditContribution = Partial<
  Pick<
    AuditEvent,
    'category' | 'eventType' | 'targetType' | 'targetId' | 'details'
  >
>;

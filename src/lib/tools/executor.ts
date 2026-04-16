// Tool Executor — the single pipeline every tool call flows through.
//
// Order (see 02-tool-executor.md §"Tool Execution Pipeline"):
//   1. Input validation   (ajv, pre-compiled)
//   2. Context            (assumed pre-assembled by the caller)
//   3. Permission check   (Pre-MVP: read-scope stub; Phase 1 swaps in
//                          the real Permission Evaluator)
//   4. Execute            (tool.call)
//   5. Format response    (responseTokens + executionMs metadata)
//   6. Audit event        (non-blocking via logEvent)
//   7. Return
//
// Pre-MVP scope intentionally leaves out:
//   - Response size caps / truncation (handled by individual tools today;
//     the shared enforcement layer lands with the Platform Agent)
//   - Rate-limit headers (MCP-server concern; attached by Task 8)
//   - Abort-signal propagation (no long-running tools yet)
//   - Write-tool branching (no write tools registered; the action map
//     only lists read tools)
//   - Real permission evaluation (see TODO in Step 3 below)

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import { logEvent } from '@/lib/audit/logger';
import type { AuditEvent } from '@/lib/audit/types';
import {
  evaluate,
  PermissionDeniedError,
} from '@/lib/agent/permissions/evaluator';

import { TOOL_ACTION_MAP, type ToolAction } from './action-map';
import { resolveResource } from './resource-resolver';
import { estimateTokens } from './token-estimator';
import type {
  Actor,
  LocusTool,
  ToolContext,
  ToolError,
  ToolResult,
} from './types';

// ---------------------------------------------------------------------------
// Module-level ajv + registry
// ---------------------------------------------------------------------------
//
// Ajv compiles schemas into validators once and caches them. The executor
// holds the singleton Ajv + a registry map so the per-call cost is just
// running the compiled validator, not re-parsing JSON Schema.

const ajv = new Ajv({ allErrors: true, coerceTypes: false });
addFormats(ajv);

interface RegisteredTool {
  tool: LocusTool;
  validate: ValidateFunction;
}

const registry = new Map<string, RegisteredTool>();

/**
 * Register a tool. Must be called at module load (or test setup) before
 * `executeTool()` can dispatch to it. Re-registering the same name
 * overwrites — useful for test setups, harmless in production where
 * registration happens once per cold start.
 */
export function registerTool(tool: LocusTool): void {
  const validate = ajv.compile(tool.inputSchema);
  registry.set(tool.name, { tool, validate });
}

/**
 * Enumerate every currently registered tool. Used by the agent harness
 * (`src/lib/agent/tool-bridge.ts`) to assemble the tool set passed to
 * `streamText` — the harness wraps each LocusTool as an AI-SDK tool and
 * delegates execution back through `executeTool()`.
 *
 * Order is registration order (Map iteration), which makes the resulting
 * tool set stable across Anthropic prompt-cache hits.
 */
export function getAllTools(): LocusTool[] {
  return Array.from(registry.values()).map((entry) => entry.tool);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Drive a tool call through the full pipeline. Never throws — every
 * failure mode is returned as `{ success: false, error }`.
 */
export async function executeTool(
  toolName: string,
  rawInput: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const startMs = Date.now();

  // ---- Step 1: Lookup + input validation --------------------------------
  const entry = registry.get(toolName);
  if (!entry) {
    // No audit event — there's no tool to attribute it to, and the API
    // route layer already logs auth-level failures.
    return buildError(
      'unknown_tool',
      `No tool registered with name '${toolName}'.`,
      {
        hint: 'Check the tool name — valid tools are listed in the MCP registration response.',
        retryable: false,
      },
      startMs,
    );
  }

  const { tool, validate } = entry;

  if (!validate(rawInput)) {
    const errors = validate.errors ?? [];
    const messages = errors.map(
      (e) => `${e.instancePath || '(root)'}: ${e.message ?? 'invalid'}`,
    );
    return buildError(
      'invalid_input',
      `Input validation failed: ${messages.join('; ')}`,
      {
        suggestions: messages,
        hint: `Check the input schema for '${tool.name}'.`,
        retryable: false,
      },
      startMs,
    );
  }

  // ---- Step 2: Context is already assembled by the caller ---------------
  // (API route layer resolves Actor + companyId + brainId + tokenId.)

  // ---- Step 3: Permission check -----------------------------------------
  //
  // TODO: Phase 1/2 — re-enable fine-grained permission checks + write-scope
  // logic. This stub only verifies the action's required scope is present on
  // the actor. No document-level ACLs, no category-scope checks, no
  // `requiresApproval` branch. `resolveResource()` runs today only so that
  // when the real evaluator lands the wiring is already in place.
  const action: ToolAction = TOOL_ACTION_MAP[tool.name] ?? inferActionFromTool(tool);
  void resolveResource(tool.name, rawInput, context);

  if (!hasScope(context.actor, action)) {
    const denied = buildError(
      'scope_denied',
      `Actor does not have '${action}' scope for tool '${tool.name}'.`,
      {
        hint:
          action === 'read'
            ? 'This token needs the "read" scope to call read tools.'
            : 'This token needs the "write" scope to call write tools.',
        retryable: false,
      },
      startMs,
    );

    // Denied calls still audit — a pattern of denials is itself a signal.
    fireAuditEvent(tool, rawInput, denied, context, { denied: true });

    return denied;
  }

  // Role-based permission check. Runs when the actor carries a `role`
  // (Platform Agent callers) and the tool declares an `action`. MCP token
  // callers (no `role`) skip this gate and rely solely on `scopes` above.
  if (context.actor.role !== undefined) {
    const toolAction = tool.action ?? (tool.isReadOnly() ? 'read' : 'write');
    try {
      evaluate(
        { actor: { role: context.actor.role }, brainId: context.brainId },
        { action: toolAction, resourceType: 'document' },
      );
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        const denied = buildError(
          'permission_denied',
          err.message,
          {
            hint:
              toolAction === 'write'
                ? 'Your role does not permit write operations on this brain.'
                : 'Your role does not permit this operation.',
            retryable: false,
          },
          startMs,
        );
        fireAuditEvent(tool, rawInput, denied, context, { denied: true });
        return denied;
      }
      throw err; // unexpected — propagate to the execution_error catch below
    }
  }

  // ---- Step 4: Execute --------------------------------------------------
  let result: ToolResult;
  try {
    result = await tool.call(rawInput, context);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown execution error';
    result = buildError(
      'execution_error',
      message,
      {
        hint: 'This may be a transient error. Try again in a few seconds.',
        retryable: true,
      },
      startMs,
    );
  }

  // ---- Step 5: Format response -----------------------------------------
  //
  // Overwrite executionMs with the executor's own wall-clock reading (the
  // tool may have set its own value to 0). Recompute responseTokens from
  // the serialized payload so the number reflects what actually crosses
  // the wire.
  const metadata = result.metadata ?? {
    responseTokens: 0,
    executionMs: 0,
    documentsAccessed: [],
  };

  const payload = result.success ? result.data : result.error;
  metadata.responseTokens = estimateTokens(safeStringify(payload));
  metadata.executionMs = Date.now() - startMs;
  metadata.documentsAccessed = metadata.documentsAccessed ?? [];

  result.metadata = metadata;

  // ---- Step 6: Audit ----------------------------------------------------
  fireAuditEvent(tool, rawInput, result, context, { denied: false });

  // ---- Step 7: Return ---------------------------------------------------
  return result;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Pre-MVP scope gate. Kept deliberately dumb — real ACL eval lives in
 * `@/lib/permissions/evaluator` starting Phase 1.
 */
function hasScope(actor: Actor, action: ToolAction): boolean {
  return actor.scopes.includes(action);
}

/**
 * Fallback when a tool name is not in `TOOL_ACTION_MAP`. Honors the
 * tool's `isReadOnly()` hint so unregistered tools still route sensibly.
 */
function inferActionFromTool(tool: LocusTool): ToolAction {
  return tool.isReadOnly() ? 'read' : 'write';
}

function buildError(
  code: string,
  message: string,
  opts: Omit<ToolError, 'code' | 'message'>,
  startMs: number,
): ToolResult {
  return {
    success: false,
    error: {
      code,
      message,
      ...opts,
    },
    metadata: {
      responseTokens: estimateTokens(message),
      executionMs: Date.now() - startMs,
      documentsAccessed: [],
    },
  };
}

function safeStringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    // Circular or otherwise unserializable payload — fall back to a rough
    // length estimate so the caller still gets a non-zero signal.
    return String(value);
  }
}

/**
 * Build + fire a `document_access` audit event. Failures inside the
 * logger are swallowed by the logger itself; we never `await` it.
 */
function fireAuditEvent(
  tool: LocusTool,
  input: unknown,
  result: ToolResult,
  context: ToolContext,
  extraDetails: Record<string, unknown>,
): void {
  const docsAccessed = result.metadata.documentsAccessed ?? [];

  // Tool-level audit trail: one row per tool call, scoped to the brain.
  // Carries the full stats (executionMs, responseTokens, errorCode, ...).
  const toolLevel: AuditEvent = {
    companyId: context.companyId,
    brainId: context.brainId,
    category: 'document_access',
    eventType: `tool.${tool.name}`,
    actorType: context.actor.type,
    actorId: context.actor.id,
    actorName: context.actor.name,
    targetType: 'brain',
    targetId: context.brainId,
    details: {
      tool: tool.name,
      success: result.success,
      executionMs: result.metadata.executionMs,
      responseTokens: result.metadata.responseTokens,
      documentsAccessed: docsAccessed,
      // Surface error code when the call failed — invaluable for
      // debugging "why is this token getting denied?" from the audit
      // trail alone.
      ...(result.error ? { errorCode: result.error.code } : {}),
      // Tool-side details (e.g., search query, section) bubble up from
      // `result.metadata.details` if the tool populated them.
      ...(result.metadata.details ?? {}),
      ...extraDetails,
    },
    sessionId: context.sessionId,
    tokenId: context.tokenId,
  };

  // Intentionally do NOT inspect the raw input — it may contain
  // sensitive content. Tools that want per-call detail should populate
  // `result.metadata.details` with the specific (non-sensitive) fields.
  void input;

  logEvent(toolLevel);

  // Per-document fan-out: one event per touched doc so the /neurons
  // feature can render a pulse on the specific node. Only on success —
  // a failed tool that reports documentsAccessed shouldn't produce
  // pulses for an action that didn't land.
  if (!result.success) return;
  for (const documentId of docsAccessed) {
    logEvent({
      companyId: context.companyId,
      brainId: context.brainId,
      category: 'document_access',
      eventType: `tool.${tool.name}`,
      actorType: context.actor.type,
      actorId: context.actor.id,
      actorName: context.actor.name,
      targetType: 'document',
      targetId: documentId,
      details: { tool: tool.name },
      sessionId: context.sessionId,
      tokenId: context.tokenId,
    });
  }
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

/** Clear the registry. Call between tests that register ad-hoc tools. */
export function __resetRegistryForTests(): void {
  registry.clear();
}

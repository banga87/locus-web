// Tool bridge — converts Phase 0 `LocusTool`s into AI SDK `tool()`
// definitions consumable by `streamText`. The bridge is intentionally
// thin:
//   - schema: wrap the LocusTool's JSON Schema with `jsonSchema()` so the
//     AI SDK treats it as a StandardSchema-ish input descriptor.
//   - execute: delegate to Phase 0's `executeTool()` so the entire
//     validation + permission + audit pipeline runs unchanged.
//   - errors: return a structured `{ error: true, code, message, hint }`
//     object as the tool result instead of throwing — the LLM sees the
//     error and can recover.
//
// Why `dynamicTool` instead of `tool`: `LocusTool`'s JSON Schema is built
// dynamically (it's not a Zod schema known at compile time), so the
// inferred input/output types would be `any` either way. `dynamicTool`
// makes that contract explicit and also signals to the AI SDK that the
// tool is runtime-defined — important once Task 3 starts feeding MCP OUT
// tools through the same bridge.

import { dynamicTool, jsonSchema, type Tool } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';

import { logEvent } from '@/lib/audit/logger';
import { generateInvocationId } from '@/lib/brain-pulse/invocation-id';
import { PROPOSE_TOOL_PREFIX } from '@/lib/context/proposals';
import { executeTool, getAllTools } from '@/lib/tools/executor';
import {
  proposeDocumentCreateTool,
  proposeDocumentUpdateTool,
} from '@/lib/tools/propose-document';
import {
  proposeSkillCreateTool,
  PROPOSE_SKILL_CREATE_TOOL_NAME,
} from '@/lib/tools/propose-skill-create';
import type { LocusTool, ToolContext } from '@/lib/tools/types';

/**
 * Metadata supplied alongside an external MCP tool so the bridge can
 * emit the paired `mcp_invocation` invoke/complete/error audit events.
 * Task 3 will populate this map per brain from the connections table;
 * today the call site passes `{}` and MCP tools are unbridged.
 *
 * `mcpConnectionId` is used as `targetId` on the audit row — the FK
 * points at the connection the tool was loaded from. `originDocId`
 * is optional and reserved for Task 4's OriginDoc-linked invocations.
 */
export interface McpToolMeta {
  mcpConnectionId: string;
  mcpName: string;
  originDocId?: string | null;
}

/**
 * Wrap a single `LocusTool` for the AI SDK. The returned definition is
 * structurally a `Tool` — the AI SDK accepts `Record<string, Tool>` as
 * its `tools` param.
 */
export function bridgeLocusTool(
  locusTool: LocusTool,
  ctx: ToolContext,
): Tool {
  return dynamicTool({
    description: locusTool.description,
    inputSchema: jsonSchema(locusTool.inputSchema as JSONSchema7),
    execute: async (args) => {
      const result = await executeTool(locusTool.name, args, ctx);
      if (!result.success) {
        // Surface the error AS the tool result, so the model sees a
        // structured payload instead of an exception. The LLM is good at
        // recovering from "this call failed because <reason>" — and this
        // mirrors how MCP errors will surface in Task 3.
        return {
          error: true,
          code: result.error?.code ?? 'execution_error',
          message: result.error?.message ?? 'Tool execution failed.',
          hint: result.error?.hint,
        };
      }
      return result.data;
    },
  });
}

/**
 * Wrap an external (MCP) tool so its execution emits paired
 * `mcp_invocation` audit events. Each call produces:
 *   - one `invoke` event at start (with a fresh `invocation_id`)
 *   - one `complete` event on success (same `invocation_id`, `duration_ms`)
 *   - one `error` event on throw (same `invocation_id`, `error_message`)
 *
 * The wrapper preserves the underlying tool's exception contract — if
 * the MCP tool throws, `bridgeMcpTool` re-throws after logging. It does
 * NOT convert errors to `{error: true, ...}` the way `bridgeLocusTool`
 * does, because MCP tool errors should surface to the AI SDK's native
 * error handling (Task 3 picks this up).
 */
export function bridgeMcpTool(
  toolName: string,
  underlying: Tool,
  ctx: ToolContext,
  meta: McpToolMeta,
): Tool {
  const actorType = ctx.actor.type;
  const actorId = ctx.actor.id;
  const actorName = ctx.actor.name ?? undefined;
  const brainId = ctx.brainId;
  const sessionId = ctx.sessionId;

  return dynamicTool({
    description: underlying.description,
    inputSchema: underlying.inputSchema,
    execute: async (args, options) => {
      const invocationId = generateInvocationId();
      const started = performance.now();

      logEvent({
        companyId: ctx.companyId,
        brainId,
        category: 'mcp_invocation',
        eventType: 'invoke',
        actorType,
        actorId,
        actorName,
        targetType: 'connection',
        targetId: meta.mcpConnectionId,
        sessionId,
        details: {
          invocation_id: invocationId,
          mcp_name: meta.mcpName,
          tool_name: toolName,
          origin_doc_id: meta.originDocId ?? null,
        },
      });

      try {
        const result = await underlying.execute!(args, options);
        const durationMs = Math.round(performance.now() - started);

        logEvent({
          companyId: ctx.companyId,
          brainId,
          category: 'mcp_invocation',
          eventType: 'complete',
          actorType,
          actorId,
          actorName,
          targetType: 'connection',
          targetId: meta.mcpConnectionId,
          sessionId,
          details: {
            invocation_id: invocationId,
            mcp_name: meta.mcpName,
            tool_name: toolName,
            origin_doc_id: meta.originDocId ?? null,
            duration_ms: durationMs,
          },
        });

        return result;
      } catch (err) {
        const durationMs = Math.round(performance.now() - started);

        logEvent({
          companyId: ctx.companyId,
          brainId,
          category: 'mcp_invocation',
          eventType: 'error',
          actorType,
          actorId,
          actorName,
          targetType: 'connection',
          targetId: meta.mcpConnectionId,
          sessionId,
          details: {
            invocation_id: invocationId,
            mcp_name: meta.mcpName,
            tool_name: toolName,
            origin_doc_id: meta.originDocId ?? null,
            duration_ms: durationMs,
            error_message: err instanceof Error ? err.message : String(err),
          },
        });

        throw err;
      }
    },
  });
}

/**
 * A LocusTool is allowed if its capability list is empty/absent OR every
 * required capability is in the caller's granted set. Propose tools pass
 * because they declare none. Web tools (capabilities: ['web']) pass only
 * when ctx.grantedCapabilities includes 'web'.
 */
function toolAllowed(tool: LocusTool, ctx: ToolContext): boolean {
  const required = tool.capabilities ?? [];
  if (required.length === 0) return true;
  return required.every((c) => ctx.grantedCapabilities.includes(c));
}

/**
 * Build the full tool set for a turn: every registered Locus brain tool
 * (4 today: search/get/diff/history) merged with the two user-gated
 * propose_document_* tools, the propose_skill_create tool, and any
 * external tools supplied by the caller. Task 3 supplies MCP OUT tools
 * via the `externalTools` arg; until then it defaults to `{}`.
 *
 * Tool names must be unique across the merged set. If an external tool
 * collides with a brain tool name, the external tool wins (spread order).
 * Caller is responsible for namespacing MCP tools to avoid collisions.
 *
 * The two propose tools — `propose_document_create` +
 * `propose_document_update` — are registered unconditionally for every
 * agent. They're side-effect-free: their `execute` functions only
 * validate input and return `{ proposal, isProposal: true }` for the
 * UI to render an Approve/Discard card. No DB writes, no Brain CRUD
 * calls — the user performs the actual write on approval. See
 * `src/lib/tools/propose-document.ts` for the full contract.
 */
export function buildToolSet(
  ctx: ToolContext,
  externalTools: Record<string, Tool> = {},
  externalToolMeta: Record<string, McpToolMeta> = {},
): Record<string, Tool> {
  const brainTools = getAllTools();
  const bridged: Record<string, Tool> = {};
  for (const t of brainTools) {
    if (!toolAllowed(t, ctx)) continue;
    bridged[t.name] = bridgeLocusTool(t, ctx);
  }
  // Propose tools are AI SDK `tool()` calls (not `dynamicTool`) because
  // their input schemas are compile-time Zod shapes; see propose-document.ts.
  // The `as Tool` coercion squares the narrower inferred type against the
  // wider `Record<string, Tool>` return contract.
  //
  // Registration keys use `PROPOSE_TOOL_PREFIX` so that the tool name the
  // LLM sees here, the prefix the PostToolUse handler matches on, and
  // the prefix the chat UI renders ProposalCard on all share one source
  // of truth. Renaming the family is a one-line change in
  // `src/lib/context/proposals.ts`.
  bridged[`${PROPOSE_TOOL_PREFIX}create`] = proposeDocumentCreateTool as Tool;
  bridged[`${PROPOSE_TOOL_PREFIX}update`] = proposeDocumentUpdateTool as Tool;
  bridged[PROPOSE_SKILL_CREATE_TOOL_NAME] = proposeSkillCreateTool as Tool;

  // External tools: if `externalToolMeta` supplies metadata keyed by the
  // same tool name, wrap in `bridgeMcpTool` to emit `mcp_invocation`
  // audit events. Otherwise pass the tool through unmodified — this
  // preserves backward compatibility for non-MCP external tools and
  // for the current chat route (which passes only `externalTools`).
  const externalBridged: Record<string, Tool> = {};
  for (const [name, tool] of Object.entries(externalTools)) {
    const meta = externalToolMeta[name];
    externalBridged[name] = meta ? bridgeMcpTool(name, tool, ctx, meta) : tool;
  }

  return { ...bridged, ...externalBridged };
}

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

import { executeTool, getAllTools } from '@/lib/tools/executor';
import {
  proposeDocumentCreateTool,
  proposeDocumentUpdateTool,
} from '@/lib/tools/propose-document';
import type { LocusTool, ToolContext } from '@/lib/tools/types';

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
 * Build the full tool set for a turn: every registered Locus brain tool
 * (4 today: search/get/diff/history) merged with the two user-gated
 * propose_document_* tools and any external tools supplied by the
 * caller. Task 3 supplies MCP OUT tools via the `externalTools` arg;
 * until then it defaults to `{}`.
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
): Record<string, Tool> {
  const brainTools = getAllTools();
  const bridged: Record<string, Tool> = {};
  for (const t of brainTools) {
    bridged[t.name] = bridgeLocusTool(t, ctx);
  }
  // Propose tools are AI SDK `tool()` calls (not `dynamicTool`) because
  // their input schemas are compile-time Zod shapes; see propose-document.ts.
  // The `as Tool` coercion squares the narrower inferred type against the
  // wider `Record<string, Tool>` return contract.
  bridged.propose_document_create = proposeDocumentCreateTool as Tool;
  bridged.propose_document_update = proposeDocumentUpdateTool as Tool;
  return { ...bridged, ...externalTools };
}

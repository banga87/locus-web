// AgentTool — the dispatch tool exposed to the parent (Platform Agent).
// The Platform Agent calls this tool to invoke a built-in subagent; the
// tool's `execute` delegates to `runSubagent`, which handles the registry
// lookup, fresh AgentContext construction, tool filtering, hook gate,
// usage attribution, and audit emission.
//
// This module owns two parent-side concerns that don't belong in the
// dispatcher:
//
//   1. **Input schema**. The AI SDK validates this when the model emits a
//      tool call; we also expose it on the returned tool so callers can
//      re-parse defensively (see propose-document.ts for precedent).
//      When the caller supplies a non-empty `agents` list, `subagent_type`
//      is narrowed to a `z.enum(...)` of the known slugs so invalid types
//      are caught at parse time. An empty list falls back to `z.string()`
//      to keep the schema valid.
//
//   2. **Per-parent-turn cap**. Without a hard limit, a misbehaving parent
//      could spam subagent calls and burn through quota. The cap is a
//      mutable counter shared across all tool.execute() calls in the same
//      parent turn. Default 10; overridable via
//      `TATARA_MAX_SUBAGENTS_PER_TURN` or an explicit `cap` option (used
//      mainly by tests).
//
// The `getParentUsageRecordId` getter exists because the parent's
// usage_records.id is only known AFTER streamText's onFinish callback
// runs — which is AFTER the Agent tool's execute has already fired once.
// A getter lets the caller's closure-captured ref flip once the id
// lands, attributing subsequent subagent calls in the same turn. The
// pilot accepts partial attribution (first subagent call sees `null`)
// in exchange for avoiding a two-phase write to usage_records.
//
// Task 2 extension: `BuildAgentToolOptions` now accepts an optional
// `agents` param (merged built-in + user-defined list). When supplied,
// the description and `subagent_type` enum are derived from that list.
// If omitted, the old `description` string path is preserved for
// backward compatibility with existing callers and tests.

import { tool, type Tool } from 'ai';
import { z } from 'zod';

import { runSubagent } from './runSubagent';
import { buildAgentToolDescription } from './prompt';
import type { AgentContext } from '@/lib/agent/types';
import type { McpToolMeta } from '@/lib/mcp-out/bridge';
import type { BuiltInAgentDefinition } from './types';

const DEFAULT_CAP = Number(
  process.env.TATARA_MAX_SUBAGENTS_PER_TURN ?? '10',
);

export interface BuildAgentToolOptions {
  parentCtx: AgentContext;
  /**
   * Getter for the parent's usage_records.id. Usage is inserted inside
   * the parent's onFinish callback, AFTER the tool's execute has already
   * run — so the subagent calls see `null` on the first read. The getter
   * lets the caller's closure-captured ref flip once the parent id lands,
   * attributing any subsequent subagent calls in the same turn. The pilot
   * accepts the partial attribution (first subagent call has a null FK)
   * in exchange for avoiding a two-phase write.
   */
  getParentUsageRecordId: () => string | null;
  /**
   * The Agent tool description string. Required when `agents` is not
   * supplied; ignored when `agents` is supplied (description is derived
   * from the list via `buildAgentToolDescription`).
   */
  description: string;
  /**
   * Merged list of built-in + user-defined agents for this turn.
   * When supplied, the tool description is derived from this list and
   * `subagent_type` is narrowed to a `z.enum(...)` of the known slugs.
   * When absent, the plain `description` string is used and `subagent_type`
   * stays as `z.string()` (backward-compatible path).
   */
  agents?: BuiltInAgentDefinition[];
  /**
   * Mutable counter shared across the Agent tool's lifetime for this
   * parent turn. Defaults to `{ limit: DEFAULT_CAP, count: 0 }`. Tests
   * pass their own object so they can assert on `count` directly.
   */
  cap?: { limit: number; count: number };
  /**
   * Optional lookup function used by `runSubagent` to resolve user-defined
   * agent definitions before falling back to the built-in registry.
   * Constructed by the caller from the `agents` list when supplied.
   */
  lookupAgent?: (agentType: string) => BuiltInAgentDefinition | undefined;
  /**
   * Parent-loaded MCP OUT tools. Threaded verbatim into `runSubagent` so
   * the subagent's tool set inherits the parent's external surface. The
   * subagent definition's `tools` / `disallowedTools` then filter the
   * merged set — a user-defined agent with a null `tool_allowlist` sees
   * everything the parent sees; one with a restricted allowlist only
   * sees the named tools. Transports are opened and closed by the parent;
   * this module never touches transport lifecycle.
   */
  externalTools?: Record<string, Tool>;
  /** Audit metadata paired 1:1 with `externalTools` (same keys). */
  externalToolMeta?: Record<string, McpToolMeta>;
}

/**
 * Build the `Agent` dispatch tool for a specific parent turn.
 *
 * Returns an AI SDK v6 `tool()` result with:
 *   - `description`: derived from `agents` list or the explicit string
 *   - `inputSchema`: a Zod schema validating the invocation shape;
 *     `subagent_type` is a `z.enum` when a non-empty `agents` list is
 *     provided, or `z.string()` when no agents are registered / when
 *     the legacy `description`-only path is used.
 *   - `execute`: the cap-gated dispatch handler
 */
export function buildAgentTool(opts: BuildAgentToolOptions) {
  const cap = opts.cap ?? { limit: DEFAULT_CAP, count: 0 };

  // Derive the description and subagent_type schema from the agents list
  // when provided; otherwise use the legacy description string + z.string().
  let toolDescription: string;
  let subagentTypeSchema: z.ZodTypeAny;

  if (opts.agents !== undefined) {
    toolDescription = buildAgentToolDescription(opts.agents);
    const agentTypes = opts.agents.map((a) => a.agentType);
    if (agentTypes.length >= 1) {
      subagentTypeSchema = z.enum(
        agentTypes as [string, ...string[]],
      );
    } else {
      // No agents available — keep schema valid but effectively uncallable.
      subagentTypeSchema = z.string();
    }
  } else {
    toolDescription = opts.description;
    subagentTypeSchema = z.string();
  }

  const lookupAgent = opts.lookupAgent;
  const externalTools = opts.externalTools;
  const externalToolMeta = opts.externalToolMeta;

  return tool({
    description: toolDescription,
    inputSchema: z.object({
      description: z.string().min(3).max(60),
      subagent_type: subagentTypeSchema,
      prompt: z.string().min(1),
    }),
    execute: async (input) => {
      if (cap.count >= cap.limit) {
        return {
          ok: false as const,
          error: `Subagent cap of ${cap.limit}/turn reached. No further subagent calls in this turn.`,
        };
      }
      // Increment synchronously BEFORE awaiting so parallel executions
      // can't all squeak past the limit check.
      cap.count += 1;
      return runSubagent(
        {
          parentCtx: opts.parentCtx,
          parentUsageRecordId: opts.getParentUsageRecordId(),
        },
        input,
        { lookupAgent, externalTools, externalToolMeta },
      );
    },
  });
}

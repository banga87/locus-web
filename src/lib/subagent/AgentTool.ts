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

import { tool } from 'ai';
import { z } from 'zod';

import { runSubagent } from './runSubagent';
import type { AgentContext } from '@/lib/agent/types';

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
  /** The Agent tool description. Supply `buildAgentToolDescription(getBuiltInAgents())` from the caller. */
  description: string;
  /**
   * Mutable counter shared across the Agent tool's lifetime for this
   * parent turn. Defaults to `{ limit: DEFAULT_CAP, count: 0 }`. Tests
   * pass their own object so they can assert on `count` directly.
   */
  cap?: { limit: number; count: number };
}

/**
 * Build the `Agent` dispatch tool for a specific parent turn.
 *
 * Returns an AI SDK v6 `tool()` result with:
 *   - `description`: the caller-supplied string
 *   - `inputSchema`: a Zod schema validating the invocation shape
 *   - `execute`: the cap-gated dispatch handler
 */
export function buildAgentTool(opts: BuildAgentToolOptions) {
  const cap = opts.cap ?? { limit: DEFAULT_CAP, count: 0 };
  return tool({
    description: opts.description,
    inputSchema: z.object({
      description: z.string().min(3).max(60),
      subagent_type: z.string(),
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
      );
    },
  });
}

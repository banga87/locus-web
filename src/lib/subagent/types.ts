// Type-only module for the subagent layer. No runtime side effects.
// Keeps the public contract for built-in agents stable even as the
// dispatcher (runSubagent) evolves.

import type { AgentContext } from '@/lib/agent/types';
import type { ApprovedModelId } from '@/lib/models/approved-models';

export interface OutputContract {
  type: 'freeform' | 'verdict' | 'json';
  /**
   * Optional validator. Return { ok: true } to pass; { ok: false, reason }
   * to force the dispatcher to return a failure result to the caller.
   * Pure function — no DB or I/O.
   */
  validator?: (text: string) => { ok: true } | { ok: false; reason: string };
}

export interface BuiltInAgentDefinition {
  /** Unique slug; also used as agentDefinitionId prefix: `builtin:<slug>`. */
  agentType: string;
  /** Parent-facing description rendered into the Agent tool description. */
  whenToUse: string;
  /** Model choice. 'inherit' reuses the parent's model; an ApprovedModelId routes via the Gateway. */
  model: ApprovedModelId | 'inherit';
  /** Explicit allowlist of tool names. Mutually exclusive with disallowedTools. */
  tools?: string[];
  /** Denylist of tool names. Typical for read-only agents. */
  disallowedTools?: string[];
  /** Builder for the agent's system prompt. Called once per dispatch. */
  getSystemPrompt: () => string;
  /** If true, skip manifest injection. Agent must call manifest_read itself if needed. */
  omitBrainContext?: boolean;
  /** Reserved — not wired in pilot. */
  background?: boolean;
  /** Max internal tool-loop steps. Default 15 when unset. */
  maxTurns?: number;
  /** Optional post-hoc validation of the subagent's final text. */
  outputContract?: OutputContract;
}

export interface SubagentInvocation {
  description: string;
  subagent_type: string;
  prompt: string;
}

export type SubagentResult =
  | {
      ok: true;
      text: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cachedInputTokens?: number;
      };
      subagentType: string;
    }
  | {
      ok: false;
      error: string;
      /** Partial output captured before failure (validator fail / maxTurns / etc.). */
      partialText?: string;
    };

/**
 * Context handed to runSubagent by the Agent tool. Separates the caller's
 * concerns (invocation params) from the harness concerns (parent context,
 * parent usage record id for attribution).
 */
export interface SubagentDispatchContext {
  parentCtx: AgentContext;
  parentUsageRecordId: string | null;
}

// Agent harness types. Modelled on claude-code's hook surface
// (`src/types/hooks.ts`) but reduced to the minimum Locus needs in Phase 1:
// in-process registration, no plugin/subprocess plumbing, no file IO. Phase 2
// will register concrete handlers (Permission Evaluator, autonomous safety
// gates, audit enrichment) into this same surface without touching `run.ts`
// or the chat route.
//
// Keep this module type-only — no runtime side effects, no imports beyond
// pure type declarations. The harness boundary (see README.md) requires it.

/**
 * Who is driving the turn. Must match `actor_type` semantics in the audit
 * logger but lives separately so the harness has no DB / Next.js coupling.
 *
 * Phase 1 only constructs `platform_agent` actors (chat route). Phase 2
 * adds `autonomous_agent` (the autonomous-loop wakeup handler) and
 * `maintenance_agent` (scheduled brain hygiene runs). All three call the
 * same `runAgentTurn` — that's the design.
 */
export interface AgentActor {
  type: 'platform_agent' | 'autonomous_agent' | 'maintenance_agent';
  /** Supabase auth user id for human-initiated turns; null for autonomous/maintenance. */
  userId: string | null;
  companyId: string;
  /** Permission scopes available to this actor. Phase 1: `['read']` everywhere. */
  scopes: string[];
}

/**
 * Fully-assembled context passed into `runAgentTurn`. The harness never
 * mutates this — fields are immutable inputs to a single turn.
 */
export interface AgentContext {
  actor: AgentActor;
  brainId: string;
  /** Convenience duplicate of `actor.companyId` so consumers don't have to dig. */
  companyId: string;
  /** Session this turn belongs to. `null` only for one-off invocations (rare). */
  sessionId: string | null;
  /** Null for the default Platform Agent; set to a document id for user-built agents. */
  agentDefinitionId?: string | null;
  /**
   * Cancellation. The route layer wires `Request.signal` to this; the
   * harness propagates it to `streamText`. Aborts cause a clean
   * `turn_complete` with `finishReason: 'aborted'`.
   */
  abortSignal: AbortSignal;
  /**
   * Capability labels granted to this actor for this turn. Derived by
   * the route layer. Harness is agnostic — it just threads the field
   * onto the ToolContext it hands to buildToolSet.
   */
  grantedCapabilities: string[];
}

/**
 * Discriminated union of everything `runAgentTurn` can yield through its
 * event generator. Non-HTTP callers (autonomous loop, subagents, eventual
 * subagent dispatch) consume this generator to make persistence + UI
 * decisions; the chat route ignores it and adapts the underlying
 * `StreamTextResult` directly via `toUIMessageStreamResponse()`.
 */
export type AgentEvent =
  | { type: 'turn_start'; turnNumber: number }
  | { type: 'llm_delta'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | {
      type: 'tool_result';
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | {
      type: 'turn_complete';
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        /** Subset of inputTokens that hit Anthropic's prompt cache. */
        cachedInputTokens?: number;
      };
      finishReason: string;
    };

/**
 * The hook event union the bus dispatches. Phase 1 ships with no
 * registered handlers — `runHook` returns `{ decision: 'allow' }` for
 * every event. Phase 2 plugs in:
 *   - Permission Evaluator → `PreToolUse`
 *   - Autonomous safety gates → `SessionStart`, `Stop`
 *   - Audit enrichment → `PostToolUse`
 *   - Subagent dispatch → `SubagentStart`
 *
 * `UserPromptSubmit` lands when prompt-injection scrubbing or budget
 * checks need to inspect the inbound message before the LLM sees it.
 */
export type HookEvent =
  | { name: 'SessionStart'; ctx: AgentContext }
  | { name: 'UserPromptSubmit'; ctx: AgentContext; message: unknown }
  | {
      name: 'PreToolUse';
      ctx: AgentContext;
      toolName: string;
      args: unknown;
    }
  | {
      name: 'PostToolUse';
      ctx: AgentContext;
      toolName: string;
      args: unknown;
      result: unknown;
      isError: boolean;
    }
  | {
      name: 'SubagentStart';
      ctx: AgentContext;
      subagentType: string;
      parentTurnId: string;
    }
  | {
      name: 'Stop';
      ctx: AgentContext;
      reason: 'completed' | 'aborted' | 'error' | 'denied';
    };

/**
 * What a handler can answer. Modelled on claude-code's three-state hook
 * decision (`approve | block | bypass`-with-output) collapsed to the
 * three Locus actually uses. `inject` lets a handler hand back a payload
 * the harness will splice into the next prompt — Phase 2 uses this for
 * brain-diff context on session resume.
 */
export type HookDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'inject'; payload: unknown };

export type HookHandler = (
  event: HookEvent,
) => Promise<HookDecision> | HookDecision;

// runAgentTurn — the single entry point for "run a turn of an agent."
//
// This is the only file in the codebase allowed to import `streamText`.
// The chat route, the future autonomous-loop wakeup handler, the future
// Maintenance Agent runner, and any subagent dispatch all funnel through
// here. Enforced via:
//   - eslint.config.mjs: `no-restricted-imports` blocks `streamText` from
//     `ai` everywhere except this file
//   - scripts/check-harness-boundary.sh: a CI grep guard
//
// The shape (plain function returning `{ result, events, denied? }`) is
// modelled on claude-code's `query()` async generator:
//   - `result` is the underlying `StreamTextResult` so HTTP callers can
//     `.toUIMessageStreamResponse()` directly without us reimplementing
//     the AI SDK's stream framing. It is `null` if SessionStart denied —
//     the route in that case builds an empty UI message stream response.
//   - `events` is a typed `AsyncGenerator<AgentEvent>` for non-HTTP
//     callers (autonomous loop, subagents) that need to react to deltas
//     and tool boundaries to drive persistence + UI.
//   - `denied` is present iff the turn was short-circuited by a
//     SessionStart deny; callers use it to surface the reason.
//
// Hook order per turn:
//   SessionStart → (tool loop: PreToolUse → tool → PostToolUse)* → Stop
//
// Stop semantics: fires EXACTLY ONCE per turn with one of four reasons:
//   - 'completed' — normal onFinish
//   - 'aborted'   — onAbort (ctx.abortSignal tripped)
//   - 'error'     — onError (streamText or a step threw)
//   - 'denied'    — SessionStart returned deny
// A module-scoped `stopFired` guard in every runAgentTurn invocation
// prevents double-firing when the AI SDK raises more than one terminal
// callback in edge cases. Never zero, never twice.
//
// Prompt caching: `providerOptions.anthropic.cacheControl = { type:
// 'ephemeral' }` is pinned on the request. Anthropic caches the system
// prompt + tool definitions (the large stable portion of every request)
// so multi-turn sessions hit the cache from turn 2 onward. ADR-003's
// pricing model assumes this — see `recordUsage()`.
//
// AI SDK version note: targets `ai@^6.0.158`. The original plan was
// written against `ai@^4.x` (`maxSteps`, `CoreMessage`, `text-delta` with
// `textDelta` field). v6 uses `stopWhen: stepCountIs(N)`, `ModelMessage`
// with `convertToModelMessages`, and `text-delta` with a `text` field.

import {
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type StreamTextOnFinishCallback,
  type StreamTextResult,
  type Tool,
  type ToolSet,
} from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

// Derive the stopWhen shape from streamText itself — the exported
// public type name has varied across v6 minor versions, so take it
// off the function signature directly.
type StreamTextStopWhen = NonNullable<Parameters<typeof streamText>[0]['stopWhen']>;

import { runHook } from './hooks';
import type { AgentContext, AgentEvent } from './types';

/**
 * Default model. Override via `params.model` from a caller that wants to
 * route to a cheaper / faster model. Phase 1 hardcodes Sonnet-4-6
 * everywhere — the routing classifier is a Phase 2 concern.
 *
 * IMPORTANT: keep in sync with `recordUsage()` model id. The cost map
 * keys on `anthropic/<modelId>`.
 */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

interface RunAgentTurnParams {
  ctx: AgentContext;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, Tool>;
  /**
   * Cap on sequential LLM steps (each tool round-trip counts as one).
   * Translated to `stopWhen: stepCountIs(N)` when `stopWhen` is not
   * provided. Kept for backward compat with the Phase 1 chat route.
   */
  maxSteps?: number;
  /** Override the default model id (string-based Anthropic path). */
  model?: string;
  /**
   * Pre-resolved model handle. Takes precedence over `model`. Used by
   * the subagent layer to route via the Vercel AI Gateway without this
   * file needing to know about the gateway.
   */
  modelHandle?: LanguageModel;
  /**
   * AI SDK v6 step-cap. Takes precedence over `maxSteps`. Supply as
   * `stopWhen: stepCountIs(N)` from the caller.
   */
  stopWhen?: StreamTextStopWhen;
  /** Forwarded to streamText. Fires after the response + all tool calls finish. */
  onFinish?: StreamTextOnFinishCallback<ToolSet>;
}

interface RunAgentTurnResult {
  /**
   * Underlying AI SDK result. HTTP routes call
   * `.toUIMessageStreamResponse()`. `null` when the turn was short-
   * circuited by a SessionStart deny — the route builds an empty UI
   * message stream response in that case (see `denied`).
   */
  result: StreamTextResult<ToolSet, never> | null;
  /** Typed event stream for non-HTTP callers. Drives autonomous-loop persistence. */
  events: AsyncGenerator<AgentEvent, void, void>;
  /** Populated iff a SessionStart hook denied. `result` is null when this is set. */
  denied?: { reason: string };
}

/**
 * Render an `inject` hook payload into a markdown string. The payload
 * shape we expect is `{ blocks: Array<{ title: string; body: string }> }`
 * — matching `InjectedContext` from `src/lib/context/types.ts`. We duck-
 * type at runtime rather than importing the type because the harness
 * must stay decoupled from the context-injection module (it's the
 * *consumer* of whatever a handler hands back, not a collaborator on
 * the payload schema).
 *
 * Rendering rules:
 *   - Each block becomes `## <title>\n\n<body>`.
 *   - Blocks are joined with `\n\n---\n\n` so the LLM sees distinct
 *     sections.
 *   - A malformed payload (missing `blocks`, non-array, non-string
 *     fields) produces an empty string — handlers that return malformed
 *     data degrade to "no extra context" rather than crashing the turn.
 *     The context module's own `buildScaffoldingPayload` is contract-
 *     bound to hand back a well-formed shape; this is defence-in-depth.
 *   - An empty `blocks` array also produces an empty string, matching
 *     the "missing scaffolding doc" degradation path in
 *     `buildScaffoldingPayload`.
 *
 * @internal This is exported for contract testing only — see
 * `src/lib/context/rendering-contract.test.ts`, which verifies the
 * duck-typed shape here stays in lock-step with `InjectedContext` /
 * `ContextBlock`. Do NOT import this from production code; use the
 * hook-bus `inject` decision instead. Exporting it does not relax the
 * harness boundary — the context module still has no import dependency
 * on the harness; the contract test is the only consumer.
 */
export function renderInjectedContext(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const blocks = (payload as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  const sections: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const title = (block as { title?: unknown }).title;
    const body = (block as { body?: unknown }).body;
    if (typeof title !== 'string' || typeof body !== 'string') continue;
    sections.push(`## ${title}\n\n${body}`);
  }
  return sections.join('\n\n---\n\n');
}

/**
 * Index of the last `role === 'user'` entry in `messages`, or -1. Used
 * by the UserPromptSubmit splice to insert a system-role context
 * message immediately before the latest user turn.
 */
function findLastUserIndex(messages: ModelMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return -1;
}

/**
 * Drive a single turn of an agent. See module header for the full hook
 * order, Stop semantics, and prompt-caching rationale.
 *
 * On SessionStart deny: returns `{ result: null, events, denied }`. The
 * events generator yields `turn_start` → `turn_complete` (finishReason
 * 'denied', zero usage) and returns. Stop fires with `reason: 'denied'`
 * before this function returns — callers don't need to drain events
 * before observing Stop.
 */
export async function runAgentTurn(
  params: RunAgentTurnParams,
): Promise<RunAgentTurnResult> {
  // Per-turn Stop-fired guard. Closed over by onFinish / onAbort /
  // onError / the deny path below. Race-free in a single-turn scope
  // (JS is single-threaded; the AI SDK won't invoke two terminal
  // callbacks at the same microtask).
  let stopFired = false;
  const fireStopOnce = async (
    reason: 'completed' | 'aborted' | 'error' | 'denied',
  ): Promise<void> => {
    if (stopFired) return;
    stopFired = true;
    await runHook({ name: 'Stop', ctx: params.ctx, reason });
  };

  // Short-circuit helper: hook deny → synthesise a denied-events
  // generator and fire Stop once. Shared between SessionStart and
  // UserPromptSubmit. Returns the standard `{ result: null, events,
  // denied }` triple every deny path yields.
  const denyTurn = async (reason: string): Promise<RunAgentTurnResult> => {
    // Fire Stop immediately so the caller observes the terminal hook
    // without having to drain events first. This also anchors the
    // "exactly once" invariant — no other path can fire Stop now.
    await fireStopOnce('denied');

    async function* deniedEvents(): AsyncGenerator<AgentEvent, void, void> {
      yield { type: 'turn_start', turnNumber: 0 };
      yield {
        type: 'turn_complete',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        finishReason: 'denied',
      };
    }

    return {
      result: null,
      events: deniedEvents(),
      denied: { reason },
    };
  };

  // --- SessionStart -----------------------------------------------------
  const startDecision = await runHook({
    name: 'SessionStart',
    ctx: params.ctx,
  });
  if (startDecision.decision === 'deny') {
    return denyTurn(startDecision.reason);
  }
  // SessionStart `inject` → splice the rendered blocks into the system
  // prompt. Session-stable context (scaffolding, agent-prompt-snippet,
  // baseline docs) lands BEFORE the base system prompt so the agent's
  // identity + available-tools guidance stays cache-stable across turns
  // while the company-specific preamble is read first. `renderInjected
  // Context` duck-types the payload — the harness doesn't import the
  // context module's `InjectedContext` type so the boundary between
  // harness and context handlers stays a plain contract (see
  // AGENTS.md).
  let systemPrompt = params.system;
  if (startDecision.decision === 'inject') {
    const rendered = renderInjectedContext(startDecision.payload);
    if (rendered) {
      systemPrompt = `${rendered}\n\n${params.system}`;
    }
  }
  // Any remaining SessionStart decision is `allow` — proceed.

  // --- UserPromptSubmit --------------------------------------------------
  // Fires once per turn, after SessionStart and before streamText. The
  // hook's `message` payload is the most recent user message from
  // `params.messages` — handlers (skills matcher, attachment inliner,
  // ingestion-filing notice) use it to decide what per-turn context to
  // splice. A `deny` here short-circuits the turn the same way
  // SessionStart deny does; an `inject` prepends a system-role message
  // right before the latest user turn so the LLM sees the context as
  // part of the current exchange without polluting the cached system
  // prompt.
  //
  // One index scan serves both the hook payload (latest user message)
  // and the splice position below — avoid a second O(n) pass.
  const lastUserIdx = findLastUserIndex(params.messages);
  const lastUserMessage =
    lastUserIdx === -1 ? undefined : params.messages[lastUserIdx];
  const promptDecision = await runHook({
    name: 'UserPromptSubmit',
    ctx: params.ctx,
    message: lastUserMessage,
  });
  if (promptDecision.decision === 'deny') {
    return denyTurn(promptDecision.reason);
  }
  let effectiveMessages: ModelMessage[] = params.messages;
  if (promptDecision.decision === 'inject') {
    const rendered = renderInjectedContext(promptDecision.payload);
    if (rendered) {
      // Per-turn context (skills, attachments) is spliced before the latest
      // user turn. This deliberately does NOT benefit from Anthropic's prompt
      // cache — per-turn content changes every turn by definition. The cache
      // boundary lives at the system prompt: session-stable content (scaffolding,
      // baseline docs via SessionStart) is concatenated onto `systemPrompt`
      // above, where cache_control markers will land in Task 9's final wiring.
      // Do NOT move this splice into the system prompt — that would make every
      // turn re-send the entire per-turn stack and invalidate the session-stable
      // cache hit.
      const insertAt = lastUserIdx === -1 ? params.messages.length : lastUserIdx;
      const systemMsg: ModelMessage = {
        role: 'system',
        content: rendered,
      };
      effectiveMessages = [
        ...params.messages.slice(0, insertAt),
        systemMsg,
        ...params.messages.slice(insertAt),
      ];
    }
  }

  // --- Stream -----------------------------------------------------------
  const result = streamText({
    // `modelHandle` wins when supplied (gateway-routed subagent callers
    // hand us a pre-resolved LanguageModel so this file stays decoupled
    // from `@ai-sdk/gateway`). Otherwise fall back to the Anthropic
    // string-based path.
    model: params.modelHandle ?? anthropic(params.model ?? DEFAULT_MODEL),
    system: systemPrompt,
    messages: effectiveMessages,
    tools: params.tools,
    // `stopWhen` wins when supplied (AI SDK v6 native shape). Otherwise
    // translate the backward-compat `maxSteps` wrapper param. Default
    // cap of 6 steps preserves the Phase 1 chat-route behaviour.
    stopWhen:
      params.stopWhen ??
      (params.maxSteps !== undefined
        ? stepCountIs(params.maxSteps)
        : stepCountIs(6)),
    abortSignal: params.ctx.abortSignal,
    providerOptions: {
      anthropic: {
        // Cache the large stable portion of each request (system prompt
        // + tool definitions). Anthropic charges cached input tokens at
        // ~10% of the uncached rate; `recordUsage()` bills accordingly.
        cacheControl: { type: 'ephemeral' },
      },
    },

    // Hook bus integration. `onStepFinish` runs after each model step
    // (an LLM call + any tool executions it triggered). We fire
    // PreToolUse before tool execution surfaces in the result stream;
    // because `streamText` runs tool execution concurrently with the
    // stream, we approximate ordering by firing PreToolUse for every
    // call seen in the step and PostToolUse for every result.
    //
    // Phase 1 limitation: PreToolUse cannot truly block a tool call here
    // — by the time `onStepFinish` runs, execution has already happened.
    // A registered `deny` will throw on the next call, but the current
    // tool already ran. Phase 2's Permission Evaluator wires earlier into
    // the tool execution path (via the `bridgeLocusTool` execute fn) to
    // close this gap. The hook fires here today so the audit + telemetry
    // story works end-to-end; permission-blocking semantics need the
    // Phase 2 wire-up.
    onStepFinish: async ({ toolCalls, toolResults }) => {
      for (const call of toolCalls ?? []) {
        const decision = await runHook({
          name: 'PreToolUse',
          ctx: params.ctx,
          toolName: call.toolName,
          args: call.input,
        });
        if (decision.decision === 'deny') {
          throw new Error(
            `tool_denied: ${call.toolName}: ${decision.reason}`,
          );
        }
      }
      for (const r of toolResults ?? []) {
        await runHook({
          name: 'PostToolUse',
          ctx: params.ctx,
          toolName: r.toolName,
          args: r.input,
          // v6 names it `output` on the result envelope. We expose it as
          // `result` to handlers because that's the more intuitive name.
          result: r.output,
          isError: false,
        });
      }
    },

    onFinish: async (finish) => {
      // Guarded by fireStopOnce — if onAbort or onError already fired
      // Stop on the error path, this becomes a no-op.
      await fireStopOnce('completed');
      if (params.onFinish) {
        await params.onFinish(finish);
      }
    },

    onAbort: async () => {
      await fireStopOnce('aborted');
    },

    onError: async () => {
      // Don't swallow — the error still propagates through the stream
      // (`tool-error` / stream-level rejection). This callback only
      // exists to pin down Stop's reason. The caller's try/catch
      // around `result.consumeStream()` or the events generator will
      // observe the original error.
      await fireStopOnce('error');
    },
  });

  async function* events(): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'turn_start', turnNumber: 0 };

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          yield { type: 'llm_delta', delta: part.text };
          break;
        case 'reasoning-delta':
          yield { type: 'reasoning', delta: part.text };
          break;
        case 'tool-call':
          yield {
            type: 'tool_start',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.input,
          };
          break;
        case 'tool-result':
          yield {
            type: 'tool_result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            result: part.output,
            isError: false,
          };
          break;
        case 'tool-error':
          yield {
            type: 'tool_result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            result: part.error,
            isError: true,
          };
          break;
        case 'abort':
          // Treat abort as terminal. Drain stops here; the trailing
          // turn_complete event below will report finishReason 'aborted'
          // once `result.finishReason` resolves. onAbort (wired above)
          // fires Stop.
          break;
        case 'error':
          // Stream-level error (e.g. provider auth failure, malformed
          // request). Without re-throwing here the loop drains silently
          // and the trailing `await result.finishReason` at the bottom
          // rejects with the AI SDK's generic `NoOutputGeneratedError`
          // ("No output generated. Check the stream for errors."),
          // discarding `part.error` entirely. Rethrow with the upstream
          // payload as the cause so the runner's try/catch walks the
          // chain and surfaces something actionable.
          throw new Error('stream_error', { cause: part.error });
        // Other part types (text-start/end, reasoning-start/end,
        // tool-input-*, source, file, start, finish, start-step,
        // finish-step, raw) are deliberately not surfaced as
        // AgentEvents. They're framing details the AI SDK uses to drive
        // its own UI message stream; non-HTTP callers don't need them.
      }
    }

    const usage = await result.usage;
    const finishReason = await result.finishReason;
    yield {
      type: 'turn_complete',
      usage: {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        // v6 splits cached tokens into read vs write; report read because
        // that's the discount path. ADR-003's billing model only cares
        // about reads (write tokens still bill at uncached rates the
        // first time).
        cachedInputTokens:
          usage.inputTokenDetails?.cacheReadTokens ??
          usage.cachedInputTokens,
      },
      finishReason,
    };
  }

  return { result, events: events() };
}

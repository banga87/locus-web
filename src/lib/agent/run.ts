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
  type ModelMessage,
  type StreamTextOnFinishCallback,
  type StreamTextResult,
  type Tool,
  type ToolSet,
} from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

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
   * Translated to `stopWhen: stepCountIs(N)` for `streamText`.
   */
  maxSteps?: number;
  /** Override the default model id. Cost map must contain a matching key. */
  model?: string;
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

  // --- SessionStart -----------------------------------------------------
  const startDecision = await runHook({
    name: 'SessionStart',
    ctx: params.ctx,
  });
  if (startDecision.decision === 'deny') {
    const reason = startDecision.reason;
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
  }
  // `inject` is a valid HookDecision variant (see types.ts — reserved
  // for Phase 2 brain-diff context on session resume), but Phase 1 has
  // no splice semantics wired in. Silently ignoring an injected payload
  // would turn a Phase 2 misconfiguration into a hard-to-diagnose "the
  // handler ran but its output vanished" bug. Throw loudly so the
  // regression is caught the moment someone registers an inject
  // handler before Phase 2 adds the splice site. Phase 2: remove this
  // guard, process `startDecision.payload`, and splice into
  // `params.messages` before calling `streamText`.
  if (startDecision.decision === 'inject') {
    throw new Error(
      'SessionStart inject payloads not yet implemented (Phase 2 — see docstring)',
    );
  }
  // Any remaining decision is `allow` — proceed to streamText.

  // --- Stream -----------------------------------------------------------
  const result = streamText({
    model: anthropic(params.model ?? DEFAULT_MODEL),
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    stopWhen: stepCountIs(params.maxSteps ?? 6),
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

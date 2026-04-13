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
// The shape (plain function returning `{ result, events }`) is modelled
// on claude-code's `query()` async generator:
//   - `result` is the underlying `StreamTextResult` so HTTP callers can
//     `.toUIMessageStreamResponse()` directly without us reimplementing
//     the AI SDK's stream framing.
//   - `events` is a typed `AsyncGenerator<AgentEvent>` for non-HTTP
//     callers (autonomous loop, subagents) that need to react to deltas
//     and tool boundaries to drive persistence + UI.
//
// Hook order per turn:
//   SessionStart → (tool loop: PreToolUse → tool → PostToolUse)* → Stop
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
  /** Underlying AI SDK result. HTTP routes call `.toUIMessageStreamResponse()`. */
  result: StreamTextResult<ToolSet, never>;
  /** Typed event stream for non-HTTP callers. Drives autonomous-loop persistence. */
  events: AsyncGenerator<AgentEvent, void, void>;
}

/**
 * Drive a single turn of an agent. See module header for the full hook
 * order and prompt-caching rationale.
 *
 * Throws `Error('session_denied: <reason>')` synchronously if a registered
 * `SessionStart` handler denies. This is intentional — the route layer
 * needs a clear failure mode before it commits to streaming a response.
 */
export async function runAgentTurn(
  params: RunAgentTurnParams,
): Promise<RunAgentTurnResult> {
  const startDecision = await runHook({
    name: 'SessionStart',
    ctx: params.ctx,
  });
  if (startDecision.decision === 'deny') {
    throw new Error(`session_denied: ${startDecision.reason}`);
  }
  // `inject` payloads are reserved for Phase 2 (brain-diff context on
  // resume). Phase 1 has nothing to splice in, so we ignore the payload
  // shape and treat any non-deny as allow.

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
      await runHook({
        name: 'Stop',
        ctx: params.ctx,
        reason: 'completed',
      });
      if (params.onFinish) {
        await params.onFinish(finish);
      }
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
          // once `result.finishReason` resolves.
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

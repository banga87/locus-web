// runAgentTurn tests. Use the AI SDK's MockLanguageModelV3 to drive the
// harness without real LLM calls. Verify:
//   - SessionStart hook runs before streamText sees anything; deny throws.
//   - PreToolUse fires for each tool call from the model; deny throws.
//   - PostToolUse fires for each tool result.
//   - Stop hook fires on completion.
//   - The events generator yields the expected sequence.
//   - providerOptions.anthropic.cacheControl is forwarded to the provider.
//   - Aborts terminate the stream cleanly.
//
// We construct the Anthropic provider through `customProvider` so we can
// substitute the mock model id used in `runAgentTurn`. Simpler: pass a
// `model` override via the params.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';

vi.mock('@ai-sdk/anthropic', () => ({
  // Replaced per-test via mockProvider.setModel(...)
  anthropic: vi.fn((modelId: string) => mockProvider.currentModel(modelId)),
}));

import { clearHooks, registerHook } from '../hooks';
import { runAgentTurn } from '../run';
import type { AgentContext, AgentEvent, HookEvent } from '../types';

// -----------------------------------------------------------------------
// Mock provider scaffolding. The factory passed into the mocked
// `@ai-sdk/anthropic` returns whatever model the current test configured.
// -----------------------------------------------------------------------

const mockProvider = {
  current: null as LanguageModelV3 | null,
  currentModel(modelId: string): LanguageModelV3 {
    if (!this.current) {
      throw new Error(
        `mockProvider.current not set — test forgot to call setModel(). Asked for ${modelId}.`,
      );
    }
    return this.current;
  },
  setModel(model: LanguageModelV3): void {
    this.current = model;
  },
  reset(): void {
    this.current = null;
  },
};

function buildCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    actor: {
      type: 'platform_agent',
      userId: 'u-test',
      companyId: 'c-test',
      scopes: ['read'],
    },
    brainId: 'b-test',
    companyId: 'c-test',
    sessionId: 's-test',
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

/**
 * Helper: build a MockLanguageModelV3 whose stream emits the supplied
 * parts, then a `finish` part with the supplied usage. Mirrors the
 * provider stream surface, NOT the higher-level `TextStreamPart`.
 */
function mockModelWithStream(
  parts: LanguageModelV3StreamPart[],
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedReadTokens?: number;
  } = { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
): MockLanguageModelV3 {
  const finish: LanguageModelV3StreamPart = {
    type: 'finish',
    // V3 provider usage shape — flat numbers under nested
    // {total, noCache, cacheRead, cacheWrite} keys. The AI SDK
    // higher level (`StreamTextResult.usage`) flattens these to
    // {inputTokens, inputTokenDetails.cacheReadTokens, ...}.
    usage: {
      inputTokens: {
        total: usage.inputTokens,
        noCache:
          usage.inputTokens != null && usage.cachedReadTokens != null
            ? usage.inputTokens - usage.cachedReadTokens
            : usage.inputTokens,
        cacheRead: usage.cachedReadTokens,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: usage.outputTokens,
        text: usage.outputTokens,
        reasoning: undefined,
      },
    },
    finishReason: { unified: 'stop', raw: 'end_turn' },
  };
  const chunks: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    ...parts,
    finish,
  ];
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks }),
    }),
  });
}

beforeEach(() => {
  mockProvider.reset();
  clearHooks();
});

afterEach(() => {
  mockProvider.reset();
  clearHooks();
});

describe('agent/run — SessionStart hook', () => {
  it('when a SessionStart hook denies, yields turn_complete with finishReason="denied" and zero usage, and Stop fires with reason="denied" (no throw)', async () => {
    // Wire a MockLanguageModelV3 so that if the harness were to
    // erroneously reach streamText, the test would notice — but it
    // shouldn't even read the model on the deny path.
    mockProvider.setModel(
      mockModelWithStream([
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'should not stream' },
        { type: 'text-end', id: 't1' },
      ]),
    );
    registerHook('SessionStart', () => ({
      decision: 'deny',
      reason: 'circuit_breaker_open',
    }));
    const stopHandler = vi.fn((_event: HookEvent) => ({
      decision: 'allow' as const,
    }));
    registerHook('Stop', stopHandler);

    const { result, events, denied } = await runAgentTurn({
      ctx: buildCtx(),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });

    // Denied runs return no StreamTextResult — the route synthesises
    // an empty UI message stream for HTTP surfaces.
    expect(result).toBeNull();
    expect(denied).toEqual({ reason: 'circuit_breaker_open' });

    // Stop fired synchronously inside runAgentTurn, before the caller
    // drains events. Callers depend on this ordering so persistence
    // decisions can land without awaiting the event generator.
    expect(stopHandler).toHaveBeenCalledTimes(1);
    expect(stopHandler.mock.calls[0]?.[0]).toMatchObject({
      name: 'Stop',
      reason: 'denied',
    });

    // Events generator yields turn_start + a terminal turn_complete
    // with zero usage, then returns cleanly.
    const collected: AgentEvent[] = [];
    for await (const event of events) {
      collected.push(event);
    }
    expect(collected).toHaveLength(2);
    expect(collected[0]).toEqual({ type: 'turn_start', turnNumber: 0 });
    expect(collected[1]).toEqual({
      type: 'turn_complete',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: 'denied',
    });
  });

  it('proceeds when no SessionStart hook is registered', async () => {
    mockProvider.setModel(
      mockModelWithStream([
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'hello' },
        { type: 'text-end', id: 't1' },
      ]),
    );

    const { result } = await runAgentTurn({
      ctx: buildCtx(),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });
    expect(result).not.toBeNull();
    // Drain the result so onFinish + Stop hook fire deterministically.
    await result!.consumeStream();
    const text = await result!.text;
    expect(text).toBe('hello');
  });

  it('rejects with an explicit error when a SessionStart hook returns decision="inject" (Phase 2 contract)', async () => {
    // `inject` is a valid HookDecision variant reserved for Phase 2's
    // brain-diff-on-resume splice. Phase 1 has no splice site wired in,
    // so silently discarding the payload would turn a Phase 2
    // misconfiguration into a debugging nightmare. runAgentTurn throws
    // loudly instead; this test pins that contract so the guard can't
    // regress before Phase 2 removes it.
    mockProvider.setModel(
      mockModelWithStream([
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'never' },
        { type: 'text-end', id: 't1' },
      ]),
    );
    registerHook('SessionStart', () => ({
      decision: 'inject',
      payload: { extraContext: 'brain-diff here' },
    }));

    await expect(
      runAgentTurn({
        ctx: buildCtx(),
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        tools: {},
      }),
    ).rejects.toThrow(/inject payloads not yet implemented/);
  });
});

describe('agent/run — events generator', () => {
  it('yields turn_start → llm_delta → turn_complete in order', async () => {
    mockProvider.setModel(
      mockModelWithStream(
        [
          { type: 'text-start', id: 't1' },
          { type: 'text-delta', id: 't1', delta: 'Hello' },
          { type: 'text-delta', id: 't1', delta: ' world' },
          { type: 'text-end', id: 't1' },
        ],
        {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cachedReadTokens: 80,
        },
      ),
    );

    const { events } = await runAgentTurn({
      ctx: buildCtx(),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });

    const collected = [];
    for await (const event of events) {
      collected.push(event);
    }

    expect(collected[0]).toEqual({ type: 'turn_start', turnNumber: 0 });
    expect(collected.filter((e) => e.type === 'llm_delta')).toEqual([
      { type: 'llm_delta', delta: 'Hello' },
      { type: 'llm_delta', delta: ' world' },
    ]);
    const last = collected[collected.length - 1];
    expect(last.type).toBe('turn_complete');
    if (last.type === 'turn_complete') {
      expect(last.usage.inputTokens).toBe(100);
      expect(last.usage.outputTokens).toBe(50);
      expect(last.usage.totalTokens).toBe(150);
      expect(last.usage.cachedInputTokens).toBe(80);
      expect(last.finishReason).toBe('stop');
    }
  });
});

describe('agent/run — Stop hook', () => {
  it('fires Stop with reason=completed when the stream finishes normally', async () => {
    mockProvider.setModel(
      mockModelWithStream([
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'ok' },
        { type: 'text-end', id: 't1' },
      ]),
    );

    const stopHandler = vi.fn((_event: HookEvent) => ({
      decision: 'allow' as const,
    }));
    registerHook('Stop', stopHandler);

    const { result } = await runAgentTurn({
      ctx: buildCtx(),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });
    expect(result).not.toBeNull();
    await result!.consumeStream();
    // onFinish fires once result drains; allow microtasks to settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(stopHandler).toHaveBeenCalledTimes(1);
    const event = stopHandler.mock.calls[0]?.[0];
    expect(event).toMatchObject({ name: 'Stop', reason: 'completed' });
  });
});

describe('agent/run — abort propagation', () => {
  it('forwards ctx.abortSignal to the provider so the stream terminates on abort', async () => {
    let receivedAbort: AbortSignal | undefined;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        receivedAbort = options.abortSignal;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: 'partial' },
              { type: 'text-end', id: 't1' },
              {
                type: 'finish',
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
                finishReason: { unified: 'stop', raw: 'end_turn' },
              },
            ] satisfies LanguageModelV3StreamPart[],
          }),
        };
      },
    });
    mockProvider.setModel(model);

    const ac = new AbortController();
    const { result } = await runAgentTurn({
      ctx: buildCtx({ abortSignal: ac.signal }),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });
    // Consume the stream so doStream actually runs and captures the
    // abort signal handed to the provider.
    expect(result).not.toBeNull();
    await result!.consumeStream();

    expect(receivedAbort).toBe(ac.signal);
  });
});

describe('agent/run — tool hook bus integration', () => {
  it('fires PreToolUse and PostToolUse for each tool call/result and yields tool events through the generator', async () => {
    const { dynamicTool, jsonSchema } = await import('ai');
    const echoTool = dynamicTool({
      description: 'echoes input',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { v: { type: 'string' } },
        required: ['v'],
      }),
      execute: async (input) => ({ echoed: (input as { v: string }).v }),
    });

    // Single-step model: one tool-call followed by finish (no second
    // turn). simulateReadableStream needs the call ID + name + JSON args.
    mockProvider.setModel(
      new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'echo',
                input: JSON.stringify({ v: 'hello' }),
              },
              {
                type: 'finish',
                usage: {
                  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 3, text: 3, reasoning: undefined },
                },
                finishReason: { unified: 'tool-calls', raw: 'tool_use' },
              },
            ] satisfies LanguageModelV3StreamPart[],
          }),
        }),
      }),
    );

    const pre = vi.fn((_event: HookEvent) => ({ decision: 'allow' as const }));
    const post = vi.fn((_event: HookEvent) => ({
      decision: 'allow' as const,
    }));
    registerHook('PreToolUse', pre);
    registerHook('PostToolUse', post);

    const { result, events } = await runAgentTurn({
      ctx: buildCtx(),
      system: 'sys',
      messages: [{ role: 'user', content: 'echo hello' }],
      tools: { echo: echoTool },
      maxSteps: 1, // stop after first step so we don't loop forever
    });

    const collected = [];
    for await (const event of events) {
      collected.push(event);
    }
    expect(result).not.toBeNull();
    await result!.consumeStream();

    expect(pre).toHaveBeenCalledTimes(1);
    expect(pre.mock.calls[0]?.[0]).toMatchObject({
      name: 'PreToolUse',
      toolName: 'echo',
      args: { v: 'hello' },
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toMatchObject({
      name: 'PostToolUse',
      toolName: 'echo',
      result: { echoed: 'hello' },
    });

    // Generator yielded tool_start + tool_result.
    const toolStart = collected.find((e) => e.type === 'tool_start');
    const toolResult = collected.find((e) => e.type === 'tool_result');
    expect(toolStart).toMatchObject({
      type: 'tool_start',
      toolCallId: 'call-1',
      toolName: 'echo',
      args: { v: 'hello' },
    });
    expect(toolResult).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'echo',
      result: { echoed: 'hello' },
      isError: false,
    });
  });
});

describe('agent/run — providerOptions caching', () => {
  it('passes anthropic cacheControl=ephemeral through to the provider', async () => {
    let receivedProviderOptions: unknown;
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        receivedProviderOptions = options.providerOptions;
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: 'ok' },
              { type: 'text-end', id: 't1' },
              {
                type: 'finish',
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
                finishReason: { unified: 'stop', raw: 'end_turn' },
              },
            ],
          }),
        };
      },
    });
    mockProvider.setModel(model);

    const { result } = await runAgentTurn({
      ctx: buildCtx(),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });
    expect(result).not.toBeNull();
    await result!.consumeStream();

    expect(receivedProviderOptions).toMatchObject({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });
});

// --------------------------------------------------------------------
// Stop hook: reason must match the terminal path. The spec (plan
// line 217) requires Stop to fire on completed / aborted / error /
// denied — ALL of them, each with the correct reason, and EXACTLY
// ONCE per turn. These tests pin the invariant.
// --------------------------------------------------------------------

describe('agent/run — Stop reason: aborted', () => {
  it('fires Stop with reason="aborted" when ctx.abortSignal aborts mid-stream', async () => {
    // Model whose stream never finishes unless aborted. We use a custom
    // ReadableStream so we can hold the stream open, let the harness
    // subscribe, then abort — triggering streamText's onAbort callback.
    const ac = new AbortController();
    let cancelled = false;
    const model = new MockLanguageModelV3({
      doStream: async ({ abortSignal }) => {
        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't1' });
            // Dangle here; no enqueue until abort.
            abortSignal?.addEventListener('abort', () => {
              cancelled = true;
              controller.error(
                new DOMException('The user aborted a request.', 'AbortError'),
              );
            });
          },
        });
        return { stream };
      },
    });
    mockProvider.setModel(model);

    const stopHandler = vi.fn((_event: HookEvent) => ({
      decision: 'allow' as const,
    }));
    registerHook('Stop', stopHandler);

    const { result } = await runAgentTurn({
      ctx: buildCtx({ abortSignal: ac.signal }),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });
    expect(result).not.toBeNull();

    // Start draining in the background, then abort.
    const consumePromise = Promise.resolve(
      result!.consumeStream({
        // Swallow the abort-as-error so consumeStream resolves rather
        // than rejecting — the runtime behaviour we care about is that
        // onAbort fired, not how callers handle the error.
        onError: () => {},
      }),
    ).catch(() => {});

    // Yield once so the provider's `start` runs and subscribes to the
    // abort signal before we trip it.
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();

    await consumePromise;
    // Extra tick to let onAbort → fireStopOnce resolve.
    await new Promise((r) => setTimeout(r, 0));

    expect(cancelled).toBe(true);
    expect(stopHandler).toHaveBeenCalledTimes(1);
    expect(stopHandler.mock.calls[0]?.[0]).toMatchObject({
      name: 'Stop',
      reason: 'aborted',
    });
  });
});

describe('agent/run — Stop reason: error', () => {
  it('fires Stop with reason="error" when streamText surfaces a stream-level error', async () => {
    // Provider emits a `{ type: 'error' }` stream part — the AI SDK
    // invokes `onError` for these.
    mockProvider.setModel(
      new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'error', error: new Error('provider_exploded') },
            ] satisfies LanguageModelV3StreamPart[],
          }),
        }),
      }),
    );

    const stopHandler = vi.fn((_event: HookEvent) => ({
      decision: 'allow' as const,
    }));
    registerHook('Stop', stopHandler);

    const { result } = await runAgentTurn({
      ctx: buildCtx(),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });
    expect(result).not.toBeNull();

    // Drain the stream. The error surfaces as an `onError`-observable
    // event; consumeStream resolves rather than throwing because we
    // provide an onError sink. The original error is still available
    // via the stream surface — we just don't need to inspect it here.
    await result!.consumeStream({ onError: () => {} });
    await new Promise((r) => setTimeout(r, 0));

    expect(stopHandler).toHaveBeenCalledTimes(1);
    expect(stopHandler.mock.calls[0]?.[0]).toMatchObject({
      name: 'Stop',
      reason: 'error',
    });
  });
});

describe('agent/run — Stop single-fire invariant', () => {
  it('fires Stop exactly once across every terminal path (completed)', async () => {
    mockProvider.setModel(
      mockModelWithStream([
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'done' },
        { type: 'text-end', id: 't1' },
      ]),
    );
    let stopCount = 0;
    registerHook('Stop', () => {
      stopCount += 1;
      return { decision: 'allow' };
    });

    const { result } = await runAgentTurn({
      ctx: buildCtx(),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });
    expect(result).not.toBeNull();
    await result!.consumeStream();
    await new Promise((r) => setTimeout(r, 0));

    expect(stopCount).toBe(1);
  });

  it('fires Stop exactly once on the deny path', async () => {
    mockProvider.setModel(
      mockModelWithStream([
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'never' },
        { type: 'text-end', id: 't1' },
      ]),
    );
    registerHook('SessionStart', () => ({
      decision: 'deny',
      reason: 'no_go',
    }));

    let stopCount = 0;
    registerHook('Stop', () => {
      stopCount += 1;
      return { decision: 'allow' };
    });

    const { events } = await runAgentTurn({
      ctx: buildCtx(),
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: {},
    });
    // Drain the generator to completion.
    for await (const _e of events) {
      // no-op
    }
    await new Promise((r) => setTimeout(r, 0));

    expect(stopCount).toBe(1);
  });
});

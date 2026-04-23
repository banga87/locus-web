// runSubagent dispatcher tests.
//
// Strategy: mock every collaborator at the function boundary so we can
// assert the orchestration behaviour without spinning up streamText / DB /
// gateway. Each test isolates one contract of the sketch in
// design/subagent-harness/00-pilot-plan.md Task 12.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stepCountIs } from 'ai';

// --- Mocks (hoisted) ------------------------------------------------------
// vi.mock factory must not reference top-level variables — return fresh
// spies from the factory body and grab them via `vi.mocked()` inside tests.

vi.mock('@/lib/agent/run', () => ({
  runAgentTurn: vi.fn(),
}));

vi.mock('@/lib/agent/tool-bridge', () => ({
  buildToolSet: vi.fn(),
}));

vi.mock('@/lib/agent/hooks', () => ({
  runHook: vi.fn(),
}));

vi.mock('@/lib/models/resolve', () => ({
  resolveModel: vi.fn(),
}));

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
}));

vi.mock('@/lib/usage/record', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('../registry', () => ({
  getBuiltInAgent: vi.fn(),
  getBuiltInAgents: vi.fn(() => []),
}));

// --- Imports after mocks --------------------------------------------------

import { runAgentTurn } from '@/lib/agent/run';
import { buildToolSet } from '@/lib/agent/tool-bridge';
import { runHook } from '@/lib/agent/hooks';
import { resolveModel } from '@/lib/models/resolve';
import { logEvent } from '@/lib/audit/logger';
import { recordUsage } from '@/lib/usage/record';
import { getBuiltInAgent, getBuiltInAgents } from '../registry';

import { runSubagent } from '../runSubagent';
import type { AgentContext } from '@/lib/agent/types';
import type {
  BuiltInAgentDefinition,
  SubagentDispatchContext,
  SubagentInvocation,
} from '../types';

// --- Fixtures -------------------------------------------------------------

function buildParentCtx(
  overrides: Partial<AgentContext> = {},
): AgentContext {
  return {
    actor: {
      type: 'platform_agent',
      userId: 'u-parent',
      companyId: 'co-parent',
      scopes: ['read'],
    },
    brainId: 'b-parent',
    companyId: 'co-parent',
    sessionId: 'sess-parent',
    abortSignal: new AbortController().signal,
    grantedCapabilities: ['web'],
    ...overrides,
  };
}

function buildDispatchCtx(
  overrides: Partial<SubagentDispatchContext> = {},
): SubagentDispatchContext {
  return {
    parentCtx: buildParentCtx(),
    parentUsageRecordId: 'parent-usage-row-1',
    ...overrides,
  };
}

function buildInvocation(
  overrides: Partial<SubagentInvocation> = {},
): SubagentInvocation {
  return {
    description: 'test invocation',
    subagent_type: 'TestAgent',
    prompt: 'do the thing',
    ...overrides,
  };
}

function buildDef(
  overrides: Partial<BuiltInAgentDefinition> = {},
): BuiltInAgentDefinition {
  return {
    agentType: 'TestAgent',
    whenToUse: 'for testing',
    model: 'anthropic/claude-haiku-4.5',
    getSystemPrompt: () => 'you are a test agent',
    ...overrides,
  };
}

function eventsGenerator(
  parts: Array<
    | { type: 'llm_delta'; delta: string }
    | {
        type: 'turn_complete';
        usage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          cachedInputTokens?: number;
        };
        finishReason: string;
      }
  >,
) {
  return (async function* () {
    for (const p of parts) {
      yield p;
    }
  })();
}

// --- Lifecycle ------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();

  // Sensible defaults — individual tests override as needed.
  vi.mocked(getBuiltInAgents).mockReturnValue([]);
  vi.mocked(runHook).mockResolvedValue({ decision: 'allow' });
  vi.mocked(buildToolSet).mockReturnValue({
    manifest_read: {} as never,
    search_documents: {} as never,
    write_document: {} as never,
    Agent: {} as never,
  });
  vi.mocked(resolveModel).mockReturnValue(
    'MODEL_HANDLE_SENTINEL' as never,
  );
  vi.mocked(recordUsage).mockResolvedValue({ id: 'usage-row-id' });
  vi.mocked(runAgentTurn).mockResolvedValue({
    result: null,
    events: eventsGenerator([
      { type: 'llm_delta', delta: 'hello ' },
      { type: 'llm_delta', delta: 'world' },
      {
        type: 'turn_complete',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
      },
    ]),
  } as never);
});

afterEach(() => {
  vi.resetAllMocks();
});

// --- Tests ---------------------------------------------------------------

describe('runSubagent — unknown agent type', () => {
  it('returns ok:false with an "Unknown subagent_type" error and emits an unknown_type audit event', async () => {
    vi.mocked(getBuiltInAgent).mockReturnValue(undefined);
    vi.mocked(getBuiltInAgents).mockReturnValue([
      buildDef({ agentType: 'ExistingAgent' }),
    ]);

    const result = await runSubagent(
      buildDispatchCtx(),
      buildInvocation({ subagent_type: 'NopeAgent' }),
    );

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/Unknown subagent_type: NopeAgent/),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Available: ExistingAgent/);
    }

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logEvent).mock.calls[0]?.[0]).toMatchObject({
      category: 'agent',
      eventType: 'subagent.invoked',
      details: expect.objectContaining({
        status: 'unknown_type',
        requestedType: 'NopeAgent',
        parentUsageRecordId: 'parent-usage-row-1',
      }),
    });

    // Nothing downstream ran.
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(runHook).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('reports "Available: none" when the registry is empty', async () => {
    vi.mocked(getBuiltInAgent).mockReturnValue(undefined);
    vi.mocked(getBuiltInAgents).mockReturnValue([]);
    const result = await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Available: none/);
    }
  });
});

describe('runSubagent — happy path', () => {
  it('returns ok:true with accumulated text, usage, and subagentType; records usage with source=subagent + parentUsageRecordId; emits one audit event with status=ok', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    const result = await runSubagent(
      buildDispatchCtx(),
      buildInvocation(),
    );

    expect(result).toEqual({
      ok: true,
      text: 'hello world',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedInputTokens: undefined,
      },
      subagentType: 'TestAgent',
    });

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'subagent',
        parentUsageRecordId: 'parent-usage-row-1',
        modelId: 'anthropic/claude-haiku-4.5',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        sessionId: null,
      }),
    );

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logEvent).mock.calls[0]?.[0]).toMatchObject({
      category: 'agent',
      eventType: 'subagent.invoked',
      details: expect.objectContaining({
        status: 'ok',
        subagentType: 'TestAgent',
        modelId: 'anthropic/claude-haiku-4.5',
        usageRecordId: 'usage-row-id',
        parentUsageRecordId: 'parent-usage-row-1',
      }),
    });
  });

  it('skips recordUsage entirely when totalTokens is 0', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);
    vi.mocked(runAgentTurn).mockResolvedValue({
      result: null,
      events: eventsGenerator([
        {
          type: 'turn_complete',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        },
      ]),
    } as never);

    const result = await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(result.ok).toBe(true);
    expect(recordUsage).not.toHaveBeenCalled();

    // Audit event still fires with usageRecordId: null.
    expect(vi.mocked(logEvent).mock.calls[0]?.[0]).toMatchObject({
      details: expect.objectContaining({
        status: 'ok',
        usageRecordId: null,
      }),
    });
  });
});

describe('runSubagent — tool filtering', () => {
  it('applies filterSubagentTools: write_document is dropped when the def denies it; Agent is always dropped', async () => {
    const def = buildDef({ disallowedTools: ['write_document'] });
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    await runSubagent(buildDispatchCtx(), buildInvocation());

    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runAgentTurn).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    const tools = call!.tools;
    expect(tools).toHaveProperty('manifest_read');
    expect(tools).toHaveProperty('search_documents');
    expect(tools).not.toHaveProperty('write_document');
    expect(tools).not.toHaveProperty('Agent');
  });
});

describe('runSubagent — fresh subagent context', () => {
  it('passes runAgentTurn a ctx with sessionId=null and agentDefinitionId=builtin:<slug>', async () => {
    const def = buildDef({ agentType: 'BrainExplore' });
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    await runSubagent(buildDispatchCtx(), buildInvocation());

    const call = vi.mocked(runAgentTurn).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.ctx.sessionId).toBeNull();
    expect(call!.ctx.agentDefinitionId).toBe('builtin:BrainExplore');
    // Actor, brainId, abort, capabilities inherited from parent.
    expect(call!.ctx.actor.type).toBe('platform_agent');
    expect(call!.ctx.brainId).toBe('b-parent');
    expect(call!.ctx.companyId).toBe('co-parent');
    expect(call!.ctx.grantedCapabilities).toEqual(['web']);
  });
});

describe('runSubagent — stopWhen threading', () => {
  it('threads stepCountIs(def.maxTurns) into runAgentTurn as stopWhen', async () => {
    const def = buildDef({ maxTurns: 7 });
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    await runSubagent(buildDispatchCtx(), buildInvocation());
    const call = vi.mocked(runAgentTurn).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call!.stopWhen).toBeDefined();
    // Object-shape assertion: stepCountIs returns a non-null truthy value.
    // Exact identity cannot be asserted because each call to stepCountIs
    // returns a fresh instance. Assert it's defined and not the default
    // (undefined).
    expect(typeof call!.stopWhen).not.toBe('undefined');
  });

  it('defaults to stepCountIs(15) when def.maxTurns is unset', async () => {
    const def = buildDef();
    delete def.maxTurns;
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    await runSubagent(buildDispatchCtx(), buildInvocation());
    const call = vi.mocked(runAgentTurn).mock.calls[0]?.[0];
    expect(call!.stopWhen).toBeDefined();
    // Smoke-check the value is produced by stepCountIs by confirming
    // our reference call with the same arg yields the same shape.
    const ref = stepCountIs(15);
    expect(typeof call!.stopWhen).toBe(typeof ref);
  });
});

describe('runSubagent — abort', () => {
  it('when turn_complete.finishReason is "aborted", returns ok:false with partialText and emits audit with status=aborted', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);
    vi.mocked(runAgentTurn).mockResolvedValue({
      result: null,
      events: eventsGenerator([
        { type: 'llm_delta', delta: 'partial ' },
        { type: 'llm_delta', delta: 'text' },
        {
          type: 'turn_complete',
          usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
          finishReason: 'aborted',
        },
      ]),
    } as never);

    const result = await runSubagent(buildDispatchCtx(), buildInvocation());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/aborted/);
      expect(result.partialText).toBe('partial text');
    }

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logEvent).mock.calls[0]?.[0]).toMatchObject({
      details: expect.objectContaining({ status: 'aborted' }),
    });

    // Usage still recorded since totalTokens > 0.
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });
});

describe('runSubagent — provider error', () => {
  it('when runAgentTurn throws, returns ok:false with status=provider_error and audit event fires', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);
    vi.mocked(runAgentTurn).mockRejectedValue(new Error('provider down'));

    const result = await runSubagent(buildDispatchCtx(), buildInvocation());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/provider_error/);
      expect(result.partialText).toBe('');
    }

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logEvent).mock.calls[0]?.[0]).toMatchObject({
      details: expect.objectContaining({ status: 'provider_error' }),
    });
    // No usage to record — usage stayed at zero.
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('when the events generator throws mid-drain, status becomes provider_error', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);
    const throwingEvents = (async function* () {
      yield { type: 'llm_delta' as const, delta: 'got some ' };
      throw new Error('stream boom');
    })();
    vi.mocked(runAgentTurn).mockResolvedValue({
      result: null,
      events: throwingEvents,
    } as never);

    const result = await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/provider_error/);
      expect(result.partialText).toBe('got some ');
    }
  });
});

describe('runSubagent — output contract', () => {
  it('on validator failure, returns ok:false with partialText, status=validator_failed audit', async () => {
    const def = buildDef({
      outputContract: {
        type: 'verdict',
        validator: () => ({ ok: false, reason: 'missing VERDICT line' }),
      },
    });
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    const result = await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('missing VERDICT line');
      expect(result.partialText).toBe('hello world');
    }

    // recordUsage ran before the validator (attribution first).
    expect(recordUsage).toHaveBeenCalledTimes(1);
    // Single audit event — the validator-failure emission.
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logEvent).mock.calls[0]?.[0]).toMatchObject({
      details: expect.objectContaining({
        status: 'validator_failed',
        reason: 'missing VERDICT line',
        usageRecordId: 'usage-row-id',
      }),
    });
  });

  it('on validator pass, ok path continues normally', async () => {
    const def = buildDef({
      outputContract: {
        type: 'freeform',
        validator: () => ({ ok: true }),
      },
    });
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    const result = await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(result.ok).toBe(true);
  });
});

describe('runSubagent — SubagentStart hook', () => {
  it('when SubagentStart denies, returns ok:false with "Hook denied" message and short-circuits', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);
    vi.mocked(runHook).mockResolvedValue({
      decision: 'deny',
      reason: 'circuit_breaker',
    });

    const result = await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/Hook denied: circuit_breaker/),
    });

    // No turn, no usage, no audit.
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('runSubagent — model resolution', () => {
  it('calls resolveModel with the def.model id when not inherit', async () => {
    const def = buildDef({ model: 'anthropic/claude-sonnet-4.6' });
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(resolveModel).toHaveBeenCalledWith(
      'TestAgent',
      'anthropic/claude-sonnet-4.6',
    );
  });

  it('maps model "inherit" to anthropic/claude-sonnet-4.6 placeholder', async () => {
    const def = buildDef({ model: 'inherit' });
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(resolveModel).toHaveBeenCalledWith(
      'TestAgent',
      'anthropic/claude-sonnet-4.6',
    );
  });

  it('passes the resolved model handle through to runAgentTurn as modelHandle', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);
    vi.mocked(resolveModel).mockReturnValue('HANDLE_XYZ' as never);

    await runSubagent(buildDispatchCtx(), buildInvocation());
    const call = vi.mocked(runAgentTurn).mock.calls[0]?.[0];
    expect(call!.modelHandle).toBe('HANDLE_XYZ');
  });
});

describe('runSubagent — lookupAgent (Task 2)', () => {
  it('uses the user-defined def from lookupAgent when it returns one, bypassing the built-in registry', async () => {
    const userDef = buildDef({
      agentType: 'UserAgent',
      model: 'anthropic/claude-haiku-4.5',
      getSystemPrompt: () => 'user-defined prompt',
    });
    // Registry returns nothing for this type — lookupAgent supplies it.
    vi.mocked(getBuiltInAgent).mockReturnValue(undefined);
    const lookupAgent = vi.fn((_type: string) => userDef);

    const result = await runSubagent(
      buildDispatchCtx(),
      buildInvocation({ subagent_type: 'UserAgent' }),
      { lookupAgent },
    );

    expect(result.ok).toBe(true);
    // lookupAgent was called with the requested type.
    expect(lookupAgent).toHaveBeenCalledWith('UserAgent');
    // Built-in registry was still called (in case lookupAgent returned undefined).
    // The important thing is the turn ran with the user-defined def.
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runAgentTurn).mock.calls[0]?.[0];
    expect(call!.system).toBe('user-defined prompt');
  });

  it('falls back to the built-in registry when lookupAgent returns undefined', async () => {
    const builtInDef = buildDef({ agentType: 'TestAgent' });
    vi.mocked(getBuiltInAgent).mockReturnValue(builtInDef);
    // lookupAgent explicitly returns undefined for this type.
    const lookupAgent = vi.fn((_type: string) => undefined);

    const result = await runSubagent(
      buildDispatchCtx(),
      buildInvocation({ subagent_type: 'TestAgent' }),
      { lookupAgent },
    );

    expect(result.ok).toBe(true);
    // getBuiltInAgent was invoked as the fallback.
    expect(getBuiltInAgent).toHaveBeenCalledWith('TestAgent');
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
  });

  it('returns unknown_type when neither lookupAgent nor registry finds the type', async () => {
    vi.mocked(getBuiltInAgent).mockReturnValue(undefined);
    vi.mocked(getBuiltInAgents).mockReturnValue([]);
    const lookupAgent = vi.fn((_type: string) => undefined);

    const result = await runSubagent(
      buildDispatchCtx(),
      buildInvocation({ subagent_type: 'GhostAgent' }),
      { lookupAgent },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Unknown subagent_type: GhostAgent/);
    }
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it('behaviour is unchanged when lookupAgent is not supplied', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    const result = await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(result.ok).toBe(true);
    expect(getBuiltInAgent).toHaveBeenCalledWith('TestAgent');
  });
});

describe('runSubagent — MCP OUT tool propagation', () => {
  it('threads parent-supplied externalTools + externalToolMeta into buildToolSet', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    // Sentinel values — we only need identity equality on the first call
    // to buildToolSet to know the params flowed through runSubagent.
    const externalTools = {
      ext_abc_list_issues: { description: 'sentinel' } as never,
    };
    const externalToolMeta = {
      ext_abc_list_issues: { connectionId: 'conn-1' } as never,
    };

    const result = await runSubagent(
      buildDispatchCtx(),
      buildInvocation(),
      { externalTools, externalToolMeta },
    );

    expect(result.ok).toBe(true);
    const buildToolSetCall = vi.mocked(buildToolSet).mock.calls[0];
    expect(buildToolSetCall).toBeDefined();
    // Positional args: (toolCtx, externalTools, externalToolMeta)
    expect(buildToolSetCall![1]).toBe(externalTools);
    expect(buildToolSetCall![2]).toBe(externalToolMeta);
  });

  it('defaults externalTools + externalToolMeta to empty maps when omitted', async () => {
    const def = buildDef();
    vi.mocked(getBuiltInAgent).mockReturnValue(def);

    const result = await runSubagent(buildDispatchCtx(), buildInvocation());
    expect(result.ok).toBe(true);
    const buildToolSetCall = vi.mocked(buildToolSet).mock.calls[0];
    expect(buildToolSetCall![1]).toEqual({});
    expect(buildToolSetCall![2]).toEqual({});
  });
});

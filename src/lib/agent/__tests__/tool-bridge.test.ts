// tool-bridge tests. Verify the contract that lets the agent harness
// reuse Phase 0's tool pipeline without modification:
//   - The bridged tool exposes the LocusTool's description + JSON Schema
//     in a shape `streamText` accepts.
//   - Calling the bridged `execute` runs through `executeTool()` (which
//     hits validation + permission + audit) and returns the LocusTool's
//     `data` payload on success.
//   - On `executeTool` failure, the bridge returns a structured
//     `{ error, code, message, hint }` object instead of throwing.
//   - `buildToolSet()` exposes every registered brain tool by name and
//     merges in external tools.
//
// We mock the audit logger because `executeTool` fires audit events on
// every call — we don't want a DB hit from the bridge tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

import { logEvent } from '@/lib/audit/logger';
import {
  registerTool,
  __resetRegistryForTests,
} from '@/lib/tools/executor';
import type { LocusTool, ToolContext, ToolResult } from '@/lib/tools/types';

import { bridgeLocusTool, buildToolSet } from '../tool-bridge';

const TEST_CTX: ToolContext = {
  actor: {
    type: 'platform_agent',
    id: 'u-test',
    scopes: ['read'],
  },
  companyId: 'c-test',
  brainId: 'b-test',
  sessionId: 's-test',
  grantedCapabilities: ['web'],
  webCallsThisTurn: 0,
};

function buildEchoTool(
  overrides: Partial<LocusTool> = {},
): LocusTool {
  return {
    name: 'echo_tool',
    description: 'Echoes its input. Used only in tests.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 } },
      required: ['name'],
      additionalProperties: false,
    },
    action: 'read' as const,
    isReadOnly: () => true,
    call: vi.fn(async (input: unknown) => {
      return {
        success: true,
        data: { echoed: (input as { name: string }).name },
        metadata: {
          responseTokens: 0,
          executionMs: 0,
          documentsAccessed: [],
        },
      } satisfies ToolResult;
    }),
    ...overrides,
  };
}

beforeEach(() => {
  __resetRegistryForTests();
});

afterEach(() => {
  __resetRegistryForTests();
});

describe('agent/tool-bridge — bridgeLocusTool', () => {
  it('produces a tool with the LocusTool description and an inputSchema', () => {
    const tool = buildEchoTool();
    registerTool(tool);

    const bridged = bridgeLocusTool(tool, TEST_CTX);
    expect(bridged.description).toBe(tool.description);
    expect(bridged.inputSchema).toBeDefined();
    expect(typeof bridged.execute).toBe('function');
  });

  it('execute() delegates to executeTool and returns the tool data on success', async () => {
    const tool = buildEchoTool();
    registerTool(tool);

    const bridged = bridgeLocusTool(tool, TEST_CTX);
    // dynamicTool's execute signature is (input, options).
    const result = await bridged.execute!(
      { name: 'hello' },
      // toolCallId + messages are required by ToolExecutionOptions but the
      // executor doesn't read them — pass minimal shape.
      {
        toolCallId: 'call-1',
        messages: [],
        abortSignal: new AbortController().signal,
      } as Parameters<NonNullable<typeof bridged.execute>>[1],
    );

    expect(result).toEqual({ echoed: 'hello' });
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('returns a structured error payload when executeTool surfaces an error', async () => {
    // Force a validation error: name field is required, omit it.
    const tool = buildEchoTool();
    registerTool(tool);

    const bridged = bridgeLocusTool(tool, TEST_CTX);
    const result = await bridged.execute!(
      {} as unknown,
      {
        toolCallId: 'call-2',
        messages: [],
        abortSignal: new AbortController().signal,
      } as Parameters<NonNullable<typeof bridged.execute>>[1],
    );

    expect(result).toMatchObject({
      error: true,
      code: 'invalid_input',
      message: expect.stringContaining('Input validation failed'),
    });
  });

  it('returns a structured error when the actor lacks the required scope', async () => {
    const tool = buildEchoTool();
    registerTool(tool);

    const noScopeCtx: ToolContext = {
      ...TEST_CTX,
      actor: { ...TEST_CTX.actor, scopes: [] }, // strip the read scope
    };

    const bridged = bridgeLocusTool(tool, noScopeCtx);
    const result = await bridged.execute!(
      { name: 'x' },
      {
        toolCallId: 'call-3',
        messages: [],
        abortSignal: new AbortController().signal,
      } as Parameters<NonNullable<typeof bridged.execute>>[1],
    );

    expect(result).toMatchObject({
      error: true,
      code: 'scope_denied',
    });
  });
});

describe('agent/tool-bridge — buildToolSet', () => {
  // Every built tool set carries these three side-effect-free propose
  // tools unconditionally. Task 7 wired the doc tools and Task 32 wired
  // propose_skill_create directly into `buildToolSet` so every agent
  // (current + future) gets the user-gated write surface without
  // per-agent configuration. See `src/lib/tools/propose-document.ts`
  // and `src/lib/tools/propose-skill-create.ts` for why they're safe
  // to register globally.
  const ALWAYS_PRESENT = [
    'propose_document_create',
    'propose_document_update',
    'propose_skill_create',
  ] as const;

  it('returns a tool for every registered LocusTool keyed by tool name', () => {
    registerTool(buildEchoTool({ name: 'tool_a' }));
    registerTool(buildEchoTool({ name: 'tool_b' }));
    registerTool(buildEchoTool({ name: 'tool_c' }));

    const set = buildToolSet(TEST_CTX);
    expect(Object.keys(set).sort()).toEqual(
      [...ALWAYS_PRESENT, 'tool_a', 'tool_b', 'tool_c'].sort(),
    );
  });

  it('merges external tools alongside brain tools', () => {
    registerTool(buildEchoTool({ name: 'tool_a' }));
    registerTool(buildEchoTool({ name: 'tool_b' }));

    const externalTool = bridgeLocusTool(
      buildEchoTool({ name: 'mcp_external' }),
      TEST_CTX,
    );

    const set = buildToolSet(TEST_CTX, { mcp_external: externalTool });
    expect(Object.keys(set).sort()).toEqual(
      [...ALWAYS_PRESENT, 'mcp_external', 'tool_a', 'tool_b'].sort(),
    );
  });

  it('always includes the user-gated propose tools even with an empty registry', () => {
    // Locked-in contract: the propose tools are side-effect-free and
    // live on every agent, so an empty LocusTool registry must still
    // produce the three approval-card tools. Replaces the former
    // "empty set" assertion.
    const set = buildToolSet(TEST_CTX);
    expect(Object.keys(set).sort()).toEqual([...ALWAYS_PRESENT].sort());
  });

  it('registers propose_skill_create with a callable execute fn', () => {
    // Task 32: skill-authoring is a user-gated proposal, same contract
    // as the doc propose tools. Registered unconditionally so every
    // agent can draft new skills; user approves before anything writes.
    const set = buildToolSet(TEST_CTX);
    expect(set).toHaveProperty('propose_skill_create');
    expect(typeof set['propose_skill_create'].execute).toBe('function');
  });
});

describe('buildToolSet — capability filter', () => {
  // Use a capability-declaring test tool, not the real web tools — this
  // test doesn't rely on registerLocusTools() and keeps mock shape tight.
  const webTool: LocusTool = {
    name: 'test_web_tool',
    description: 'Test tool that declares web capability.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    capabilities: ['web'],
    action: 'read' as const,
    isReadOnly: () => true,
    call: vi.fn(async () => ({
      success: true,
      data: {},
      metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
    })),
  };

  it('includes a tool with no capabilities declared regardless of granted capabilities', () => {
    registerTool(buildEchoTool({ name: 'unrestricted' }));
    const ctx: ToolContext = { ...TEST_CTX, grantedCapabilities: [] };
    const set = buildToolSet(ctx);
    expect(set).toHaveProperty('unrestricted');
  });

  it('excludes a web-capability tool when the ctx has no web capability', () => {
    registerTool(webTool);
    const ctx: ToolContext = { ...TEST_CTX, grantedCapabilities: [] };
    const set = buildToolSet(ctx);
    expect(set).not.toHaveProperty('test_web_tool');
  });

  it('includes a web-capability tool when the ctx grants web', () => {
    registerTool(webTool);
    const ctx: ToolContext = { ...TEST_CTX, grantedCapabilities: ['web'] };
    const set = buildToolSet(ctx);
    expect(set).toHaveProperty('test_web_tool');
  });

  it('excludes a tool requiring multiple caps when only one is granted', () => {
    const multiCap: LocusTool = {
      ...webTool,
      name: 'multi_cap_tool',
      capabilities: ['web', 'write'],
    };
    registerTool(multiCap);
    const ctx: ToolContext = { ...TEST_CTX, grantedCapabilities: ['web'] };
    const set = buildToolSet(ctx);
    expect(set).not.toHaveProperty('multi_cap_tool');
  });

  it('still includes the unconditional propose tools even when grantedCapabilities is empty', () => {
    const ctx: ToolContext = { ...TEST_CTX, grantedCapabilities: [] };
    const set = buildToolSet(ctx);
    expect(set).toHaveProperty('propose_document_create');
    expect(set).toHaveProperty('propose_document_update');
  });
});

describe('tool-bridge — mcp_invocation emission', () => {
  beforeEach(() => {
    vi.mocked(logEvent).mockClear();
  });

  function makeMcpCtx(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
      actor: {
        type: 'agent_token',
        id: 'tok-marketing',
        name: 'Marketing',
        scopes: ['read'],
      },
      companyId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      brainId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      sessionId: 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa',
      grantedCapabilities: [],
      webCallsThisTurn: 0,
      ...overrides,
    };
  }

  it('emits invoke + complete events for successful MCP tool calls', async () => {
    const { dynamicTool, jsonSchema } = await import('ai');
    const externalTools = {
      'mcp__stripe__search_prices': dynamicTool({
        description: 'Search Stripe prices',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => ({ prices: [{ id: 'price_1' }] }),
      }),
    };
    const externalToolMeta = {
      'mcp__stripe__search_prices': { mcpConnectionId: 'm-stripe', mcpName: 'Stripe' },
    };

    const tools = buildToolSet(makeMcpCtx(), externalTools, externalToolMeta);
    await tools['mcp__stripe__search_prices'].execute!({}, {} as never);

    const mcpCalls = vi.mocked(logEvent).mock.calls
      .map((c) => c[0])
      .filter((e) => e.category === 'mcp_invocation');
    expect(mcpCalls).toHaveLength(2);

    const invoke = mcpCalls.find((e) => e.eventType === 'invoke');
    const complete = mcpCalls.find((e) => e.eventType === 'complete');
    expect(invoke).toBeDefined();
    expect(complete).toBeDefined();
    expect(invoke!.details).toMatchObject({
      mcp_name: 'Stripe',
      tool_name: 'mcp__stripe__search_prices',
    });
    expect(invoke!.details!.invocation_id).toBe(complete!.details!.invocation_id);
    expect(invoke!.brainId).toBe('bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
  });

  it('emits invoke + error when the MCP tool throws', async () => {
    const { dynamicTool, jsonSchema } = await import('ai');
    const externalTools = {
      'mcp__stripe__boom': dynamicTool({
        description: 'Always fails',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => { throw new Error('stripe exploded'); },
      }),
    };
    const externalToolMeta = {
      'mcp__stripe__boom': { mcpConnectionId: 'm-stripe', mcpName: 'Stripe' },
    };

    const tools = buildToolSet(makeMcpCtx(), externalTools, externalToolMeta);
    await expect(tools['mcp__stripe__boom'].execute!({}, {} as never)).rejects.toThrow('stripe exploded');

    const mcpCalls = vi.mocked(logEvent).mock.calls
      .map((c) => c[0])
      .filter((e) => e.category === 'mcp_invocation');
    expect(mcpCalls.map((e) => e.eventType).sort()).toEqual(['error', 'invoke']);
    const error = mcpCalls.find((e) => e.eventType === 'error');
    expect(error!.details!.error_message).toBe('stripe exploded');
  });

  it('does NOT emit mcp_invocation for external tools without metadata', async () => {
    const { dynamicTool, jsonSchema } = await import('ai');
    const externalTools = {
      'some_unlisted_tool': dynamicTool({
        description: 'Not MCP',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => ({ ok: true }),
      }),
    };
    const tools = buildToolSet(makeMcpCtx(), externalTools, {});
    await tools['some_unlisted_tool'].execute!({}, {} as never);

    const mcpCalls = vi.mocked(logEvent).mock.calls
      .map((c) => c[0])
      .filter((e) => e.category === 'mcp_invocation');
    expect(mcpCalls).toHaveLength(0);
  });
});

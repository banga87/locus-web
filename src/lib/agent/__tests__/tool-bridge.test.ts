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
  // Every built tool set carries these two side-effect-free propose
  // tools unconditionally. Task 7 wired them directly into
  // `buildToolSet` so every agent (current + future) gets the user-
  // gated write surface without per-agent configuration. See
  // `src/lib/tools/propose-document.ts` for why they're safe to
  // register globally.
  const ALWAYS_PRESENT = [
    'propose_document_create',
    'propose_document_update',
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
    // produce the two approval-card tools. Replaces the former
    // "empty set" assertion.
    const set = buildToolSet(TEST_CTX);
    expect(Object.keys(set).sort()).toEqual([...ALWAYS_PRESENT].sort());
  });
});

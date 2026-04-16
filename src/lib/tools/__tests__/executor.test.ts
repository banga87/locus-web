// Tool Executor unit tests. No DB required — `logEvent` is mocked.
//
// The executor is the backbone both the MCP server (Task 8) and the
// future Platform Agent will call, so these tests pin down the public
// contract: validation shape, permission gate, audit fan-out, metadata.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// IMPORTANT: the mock must be hoisted above the executor import so
// `executor.ts`'s `import { logEvent } from '@/lib/audit/logger'` binds
// to the mock, not the real logger.
vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

import { logEvent } from '@/lib/audit/logger';
import {
  executeTool,
  registerTool,
  __resetRegistryForTests,
} from '../executor';
import { estimateTokens } from '../token-estimator';
import type { LocusTool, ToolContext, ToolResult } from '../types';

const TEST_COMPANY_ID = '00000000-0000-0000-0000-0000000a0d17';
const TEST_BRAIN_ID = '11111111-1111-1111-1111-111111111111';
const TEST_TOKEN_ID = '22222222-2222-2222-2222-222222222222';

function buildContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    actor: {
      type: 'agent_token',
      id: TEST_TOKEN_ID,
      scopes: ['read'],
    },
    companyId: TEST_COMPANY_ID,
    brainId: TEST_BRAIN_ID,
    tokenId: TEST_TOKEN_ID,
    grantedCapabilities: ['web'],
    webCallsThisTurn: 0,
    ...overrides,
  };
}

/**
 * Minimal read tool used across the suite. Schema requires `name: string`
 * and echoes it back. `isReadOnly()` returns true so the Pre-MVP
 * `read`-scope gate applies.
 */
function buildMockTool(overrides: Partial<LocusTool> = {}): LocusTool {
  return {
    name: 'mock_echo',
    description: 'Echoes its input. Used only in tests.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
      },
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
          responseTokens: 0, // executor will recompute
          executionMs: 0, // executor will overwrite
          documentsAccessed: [],
        },
      } satisfies ToolResult;
    }),
    ...overrides,
  };
}

describe('tools/executor — registration + lookup', () => {
  beforeEach(() => {
    __resetRegistryForTests();
    vi.mocked(logEvent).mockClear();
  });

  afterEach(() => {
    __resetRegistryForTests();
  });

  it('returns unknown_tool when the tool is not registered', async () => {
    const result = await executeTool('does_not_exist', {}, buildContext());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('unknown_tool');
    expect(result.error?.retryable).toBe(false);
    // Missing-tool failures should not hit the audit log — there's no tool
    // context to audit against.
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('tools/executor — input validation', () => {
  beforeEach(() => {
    __resetRegistryForTests();
    vi.mocked(logEvent).mockClear();
  });

  it('returns invalid_input with ajv messages when required field is missing', async () => {
    const tool = buildMockTool();
    registerTool(tool);

    const result = await executeTool('mock_echo', {}, buildContext());

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('invalid_input');
    expect(result.error?.retryable).toBe(false);
    // ajv should have surfaced the missing `name` requirement.
    expect(result.error?.suggestions).toBeDefined();
    expect(result.error?.suggestions?.join(' ')).toMatch(/name/);
    // Tool must not have been called.
    expect(tool.call).not.toHaveBeenCalled();
  });

  it('returns invalid_input when field has wrong type (no coercion)', async () => {
    registerTool(buildMockTool());

    // `name` should be a string. Passing a number must fail even though
    // JSON coercion would otherwise accept it.
    const result = await executeTool(
      'mock_echo',
      { name: 123 },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('invalid_input');
    expect(result.error?.suggestions?.join(' ')).toMatch(/string/i);
  });

  it('rejects additional properties when schema forbids them', async () => {
    registerTool(buildMockTool());

    const result = await executeTool(
      'mock_echo',
      { name: 'ok', extra: 'nope' },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('invalid_input');
  });
});

describe('tools/executor — permission gate (read-scope stub)', () => {
  beforeEach(() => {
    __resetRegistryForTests();
    vi.mocked(logEvent).mockClear();
  });

  it('allows a read tool when actor has read scope', async () => {
    const tool = buildMockTool();
    registerTool(tool);

    const result = await executeTool(
      'mock_echo',
      { name: 'alice' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ echoed: 'alice' });
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('denies with scope_denied when actor lacks read scope', async () => {
    const tool = buildMockTool();
    registerTool(tool);

    const result = await executeTool(
      'mock_echo',
      { name: 'alice' },
      buildContext({
        actor: { type: 'agent_token', id: TEST_TOKEN_ID, scopes: [] },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('scope_denied');
    expect(result.error?.retryable).toBe(false);
    expect(tool.call).not.toHaveBeenCalled();

    // Denied access still fires an audit event (see 02-tool-executor.md
    // "Why permission denials still fire audit events").
    expect(logEvent).toHaveBeenCalledTimes(1);
  });
});

describe('tools/executor — execution + metadata + audit', () => {
  beforeEach(() => {
    __resetRegistryForTests();
    vi.mocked(logEvent).mockClear();
  });

  it('calls the tool with the validated input and the context', async () => {
    const tool = buildMockTool();
    registerTool(tool);
    const ctx = buildContext();

    await executeTool('mock_echo', { name: 'bob' }, ctx);

    expect(tool.call).toHaveBeenCalledTimes(1);
    expect(tool.call).toHaveBeenCalledWith({ name: 'bob' }, ctx);
  });

  it('populates executionMs with a non-negative number', async () => {
    registerTool(
      buildMockTool({
        call: vi.fn(async () => {
          // Small but non-zero work so the wall clock advances at least a
          // fraction of a millisecond on most systems.
          await new Promise((resolve) => setTimeout(resolve, 2));
          return {
            success: true,
            data: { ok: true },
            metadata: {
              responseTokens: 0,
              executionMs: 0,
              documentsAccessed: [],
            },
          } satisfies ToolResult;
        }),
      }),
    );

    const result = await executeTool(
      'mock_echo',
      { name: 'x' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    expect(typeof result.metadata.executionMs).toBe('number');
    expect(result.metadata.executionMs).toBeGreaterThanOrEqual(0);
  });

  it('computes responseTokens via estimateTokens(JSON.stringify(data))', async () => {
    const tool = buildMockTool();
    registerTool(tool);

    const result = await executeTool(
      'mock_echo',
      { name: 'tokenized' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    const expected = estimateTokens(JSON.stringify({ echoed: 'tokenized' }));
    expect(result.metadata.responseTokens).toBe(expected);
  });

  it('fires a logEvent() after a successful tool call', async () => {
    registerTool(buildMockTool());

    await executeTool('mock_echo', { name: 'audited' }, buildContext());

    expect(logEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(logEvent).mock.calls[0]?.[0];
    expect(event).toBeDefined();
    expect(event?.companyId).toBe(TEST_COMPANY_ID);
    expect(event?.category).toBe('document_access');
    expect(event?.actorType).toBe('agent_token');
    expect(event?.actorId).toBe(TEST_TOKEN_ID);
    expect(event?.tokenId).toBe(TEST_TOKEN_ID);
    expect(event?.details).toMatchObject({
      tool: 'mock_echo',
      denied: false,
    });
  });

  it('stamps brainId on the tool-level audit event', async () => {
    // Without brainId the Supabase Realtime filter `brain_id=eq.<uuid>`
    // never matches and the /neurons subscription drops the row.
    registerTool(buildMockTool());

    await executeTool('mock_echo', { name: 'x' }, buildContext());

    const event = vi.mocked(logEvent).mock.calls[0]?.[0];
    expect(event?.brainId).toBe(TEST_BRAIN_ID);
  });

  it('fans out one per-document event for each accessed doc', async () => {
    // Required for the /neurons pulse feature — pulses target a specific
    // document node, which needs targetType="document" + targetId=<doc>.
    const DOC_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const DOC_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    registerTool(
      buildMockTool({
        call: vi.fn(async () => ({
          success: true,
          data: { ok: true },
          metadata: {
            responseTokens: 0,
            executionMs: 0,
            documentsAccessed: [DOC_A, DOC_B],
          },
        })),
      }),
    );

    await executeTool('mock_echo', { name: 'x' }, buildContext());

    // 1 tool-level event + 2 per-document events = 3
    expect(logEvent).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(logEvent).mock.calls.map((c) => c[0]);

    const toolLevel = calls.find((e) => e.targetType === 'brain');
    expect(toolLevel?.targetId).toBe(TEST_BRAIN_ID);
    expect(toolLevel?.brainId).toBe(TEST_BRAIN_ID);

    const perDoc = calls.filter((e) => e.targetType === 'document');
    expect(perDoc).toHaveLength(2);
    expect(perDoc.map((e) => e.targetId).sort()).toEqual([DOC_A, DOC_B].sort());
    for (const evt of perDoc) {
      expect(evt.brainId).toBe(TEST_BRAIN_ID);
      expect(evt.category).toBe('document_access');
      expect(evt.actorId).toBe(TEST_TOKEN_ID);
      expect(evt.eventType).toBe('tool.mock_echo');
    }
  });

  it('does not fan out when documentsAccessed is empty', async () => {
    // No accessed docs → only the tool-level event. Avoids gratuitous
    // inserts for web tools and search-with-no-hits.
    registerTool(buildMockTool()); // default mock has documentsAccessed: []

    await executeTool('mock_echo', { name: 'x' }, buildContext());

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logEvent).mock.calls[0]?.[0].targetType).toBe('brain');
  });

  it('does not fan out on failed tool calls', async () => {
    // A partially-completed read that reports documentsAccessed on failure
    // could otherwise produce misleading pulses for an action that didn't
    // succeed. One audit row (the tool-level one) is enough for the trail.
    registerTool(
      buildMockTool({
        call: vi.fn(async () => {
          throw new Error('boom');
        }),
      }),
    );

    await executeTool('mock_echo', { name: 'x' }, buildContext());

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logEvent).mock.calls[0]?.[0].targetType).toBe('brain');
  });

  it('wraps tool exceptions as execution_error and still audits', async () => {
    registerTool(
      buildMockTool({
        call: vi.fn(async () => {
          throw new Error('boom');
        }),
      }),
    );

    const result = await executeTool(
      'mock_echo',
      { name: 'x' },
      buildContext(),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('execution_error');
    expect(result.error?.message).toContain('boom');
    expect(result.error?.retryable).toBe(true);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });
});

describe('tools/token-estimator', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1); // ceil(1/4) = 1
    expect(estimateTokens('abcd')).toBe(1); // ceil(4/4) = 1
    expect(estimateTokens('abcde')).toBe(2); // ceil(5/4) = 2
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

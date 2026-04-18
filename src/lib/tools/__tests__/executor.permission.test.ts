// Executor permission pathway integration test.
//
// Verifies the role-based permission gate added in Task 1: a viewer actor
// attempting a write-tagged tool receives a `permission_denied` error result
// and the underlying tool implementation is never called.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { LocusTool, ToolContext, ToolResult } from '../types';

const TEST_COMPANY_ID = '00000000-0000-0000-0000-0000000a0d17';
const TEST_BRAIN_ID = '11111111-1111-1111-1111-111111111111';
const TEST_USER_ID = '33333333-3333-3333-3333-333333333333';

function buildContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    actor: {
      type: 'human',
      id: TEST_USER_ID,
      scopes: ['read', 'write'],
      role: 'viewer',
    },
    companyId: TEST_COMPANY_ID,
    brainId: TEST_BRAIN_ID,
    grantedCapabilities: [],
    webCallsThisTurn: 0,
    ...overrides,
  };
}

/** Minimal write-tagged tool for permission gate tests. */
function buildWriteTool(overrides: Partial<LocusTool> = {}): LocusTool {
  return {
    name: 'mock_write',
    description: 'Simulates a write tool. Used only in permission tests.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', minLength: 1 },
      },
      required: ['content'],
      additionalProperties: false,
    },
    action: 'write',
    resourceType: 'document' as const,
    isReadOnly: () => false,
    call: vi.fn(async () => {
      return {
        success: true,
        data: { written: true },
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

describe('executor — role-based permission gate', () => {
  beforeEach(() => {
    __resetRegistryForTests();
    vi.mocked(logEvent).mockClear();
  });

  afterEach(() => {
    __resetRegistryForTests();
  });

  it('denies viewer from calling a write-tagged tool and does not call the impl', async () => {
    const tool = buildWriteTool();
    registerTool(tool);

    const result = await executeTool(
      'mock_write',
      { content: 'hello' },
      buildContext({ actor: { type: 'human', id: TEST_USER_ID, scopes: ['read', 'write'], role: 'viewer' } }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('permission_denied');
    expect(result.error?.retryable).toBe(false);
    // The underlying implementation must NOT have been called.
    expect(tool.call).not.toHaveBeenCalled();
    // Denial still fires an audit event.
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('allows editor to call a write-tagged tool', async () => {
    const tool = buildWriteTool();
    registerTool(tool);

    const result = await executeTool(
      'mock_write',
      { content: 'hello' },
      buildContext({ actor: { type: 'human', id: TEST_USER_ID, scopes: ['read', 'write'], role: 'editor' } }),
    );

    expect(result.success).toBe(true);
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('allows owner to call a write-tagged tool', async () => {
    const tool = buildWriteTool();
    registerTool(tool);

    const result = await executeTool(
      'mock_write',
      { content: 'hello' },
      buildContext({ actor: { type: 'human', id: TEST_USER_ID, scopes: ['read', 'write'], role: 'owner' } }),
    );

    expect(result.success).toBe(true);
    expect(tool.call).toHaveBeenCalledTimes(1);
  });

  it('allows viewer to call a read-tagged tool', async () => {
    const readTool: LocusTool = {
      name: 'mock_read',
      description: 'Simulates a read tool.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      action: 'read',
      resourceType: 'document' as const,
      isReadOnly: () => true,
      call: vi.fn(async () => ({
        success: true,
        data: { found: true },
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      })),
    };
    registerTool(readTool);

    const result = await executeTool(
      'mock_read',
      { id: 'abc' },
      buildContext({ actor: { type: 'human', id: TEST_USER_ID, scopes: ['read'], role: 'viewer' } }),
    );

    expect(result.success).toBe(true);
    expect(readTool.call).toHaveBeenCalledTimes(1);
  });

  it('skips role check for actors without a role (MCP token actors)', async () => {
    // MCP token actors have scopes but no role — they should still work via
    // the scope gate alone, without the role-based evaluator running.
    const tool = buildWriteTool();
    registerTool(tool);

    const result = await executeTool(
      'mock_write',
      { content: 'hello' },
      buildContext({
        actor: { type: 'agent_token', id: 'tok-123', scopes: ['read', 'write'] },
        // No `role` field — the evaluator should be skipped.
      }),
    );

    // Passes the scope check (has 'write' scope) and skips the role check.
    expect(result.success).toBe(true);
    expect(tool.call).toHaveBeenCalledTimes(1);
  });
});

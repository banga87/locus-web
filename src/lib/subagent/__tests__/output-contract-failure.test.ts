// BrainExplore output-contract failure integration test.
//
// Same mocking pattern as `brain-explore.integration.test.ts`, but the
// canned LLM response has a MALFORMED Sources bullet (the `id` backtick
// field is missing). Asserts that the real BrainExplore validator
// rejects the text and runSubagent returns ok:false with partialText and
// a validator_failed audit event.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (hoisted) ------------------------------------------------------

// Malformed Sources block: missing the `id` field on the bullet. The
// BrainExplore validator requires each source line to include both
// slug:`…` AND id:`…` — this should trip the `slug or id` branch.
const malformedResponse = `
1. Answer: Something.

2. Sources
   - Foo — slug: \`foo\`
`;

vi.mock('@/lib/agent/run', () => ({
  runAgentTurn: vi.fn().mockImplementation(async () => ({
    result: null,
    events: (async function* () {
      yield { type: 'llm_delta', delta: malformedResponse };
      yield {
        type: 'turn_complete',
        usage: {
          inputTokens: 80,
          outputTokens: 20,
          totalTokens: 100,
          cachedInputTokens: 0,
        },
        finishReason: 'stop',
      };
    })(),
  })),
  DEFAULT_MODEL: 'claude-sonnet-4-6',
}));

vi.mock('@/lib/agent/tool-bridge', () => ({
  buildToolSet: vi.fn().mockReturnValue({
    manifest_read: {},
    search_documents: {},
    get_document: {},
    get_frontmatter: {},
  }),
}));

vi.mock('@/lib/agent/hooks', () => ({
  runHook: vi.fn().mockResolvedValue({ decision: 'allow' }),
}));

vi.mock('@/lib/usage/record', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
}));

vi.mock('@/lib/models/resolve', () => ({
  resolveModel: vi.fn().mockReturnValue({ __mock: 'sentinel' }),
}));

// DO NOT mock ../registry or ../built-in — the REAL BrainExplore
// validator is what we want to trip.

// --- Imports after mocks --------------------------------------------------

import { recordUsage } from '@/lib/usage/record';
import { logEvent } from '@/lib/audit/logger';
import { resolveModel } from '@/lib/models/resolve';

import { runSubagent } from '../runSubagent';
import type { AgentContext } from '@/lib/agent/types';

// --- Fixtures -------------------------------------------------------------

const parentCtx: AgentContext = {
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
  grantedCapabilities: [],
};

beforeEach(() => {
  vi.mocked(recordUsage).mockReset().mockResolvedValue({ id: 'usage-row-789' });
  vi.mocked(logEvent).mockReset();
  vi.mocked(resolveModel).mockClear();
});

// --- Tests ---------------------------------------------------------------

describe('BrainExplore output-contract failure', () => {
  it('returns ok:false with validator error and partialText populated', async () => {
    const res = await runSubagent(
      { parentCtx, parentUsageRecordId: 'parent-row-456' },
      {
        description: 'find pricing',
        subagent_type: 'BrainExplore',
        prompt: 'What is our pricing?',
      },
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/slug or id|Missing|Source line/i);
    expect(res.partialText).toBeDefined();
    expect(res.partialText).toContain('Sources');
    expect(res.partialText).toContain('Foo');
  });

  it('emits a validator_failed audit event with details.reason populated', async () => {
    await runSubagent(
      { parentCtx, parentUsageRecordId: 'parent-row-456' },
      {
        description: 'find pricing',
        subagent_type: 'BrainExplore',
        prompt: 'q',
      },
    );

    expect(logEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(logEvent).mock.calls[0]?.[0];
    expect(event).toMatchObject({
      category: 'agent',
      eventType: 'subagent.invoked',
      details: expect.objectContaining({
        status: 'validator_failed',
        subagentType: 'BrainExplore',
      }),
    });
    // Reason must be populated (non-empty string describing the failure).
    expect(event?.details?.reason).toBeTruthy();
    expect(typeof event?.details?.reason).toBe('string');
  });

  it('still records usage before the validator runs (attribution-first)', async () => {
    await runSubagent(
      { parentCtx, parentUsageRecordId: 'parent-row-456' },
      {
        description: 'find pricing',
        subagent_type: 'BrainExplore',
        prompt: 'q',
      },
    );

    // recordUsage fires BEFORE the output validator; we should still see
    // the usage row written even though the final result is a failure.
    expect(recordUsage).toHaveBeenCalledTimes(1);
    const args = vi.mocked(recordUsage).mock.calls[0]?.[0];
    expect(args).toMatchObject({
      source: 'subagent',
      parentUsageRecordId: 'parent-row-456',
      modelId: 'anthropic/claude-haiku-4.5',
    });
  });
});

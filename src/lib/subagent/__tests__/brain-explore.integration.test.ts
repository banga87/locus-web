// BrainExplore end-to-end integration test.
//
// Unlike `runSubagent.test.ts` which mocks `../registry` wholesale, this
// file lets the REAL registry + BRAIN_EXPLORE_AGENT def + validator run.
// We only mock the collaborators BELOW runSubagent that would otherwise
// require a real LLM, a real DB, or real audit I/O:
//   - @/lib/agent/run          → canned events generator (stand-in for streamText)
//   - @/lib/agent/tool-bridge  → minimal fake toolset
//   - @/lib/agent/hooks        → allow decision
//   - @/lib/models/resolve     → sentinel handle
//   - @/lib/audit/logger       → spy
//   - @/lib/usage/record       → spy returning a fake row id
//
// This exercises the wiring from Agent dispatch → runSubagent → registry
// → BRAIN_EXPLORE_AGENT definition → output validator → audit/usage sinks.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (hoisted) ------------------------------------------------------

// Canonical well-formed Sources block. The em-dash separator is U+2014
// (single character) — the BrainExplore validator demands the exact char.
const canonicalResponse = `
1. Answer: Our pricing model is usage-based with 30% markup per ADR-003.

2. Sources
   - Pricing Runbook — slug: \`pricing-runbook\` — id: \`doc-uuid-1\`
   - ADR-003 Markup — slug: \`adr-003\` — id: \`doc-uuid-2\`
`;

vi.mock('@/lib/agent/run', () => ({
  runAgentTurn: vi.fn().mockImplementation(async () => ({
    result: null,
    events: (async function* () {
      yield { type: 'llm_delta', delta: canonicalResponse };
      yield {
        type: 'turn_complete',
        usage: {
          inputTokens: 150,
          outputTokens: 60,
          totalTokens: 210,
          cachedInputTokens: 20,
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

// DO NOT mock ../registry or ../built-in — the real BrainExplore def
// resolves through those paths, which is the integration angle.

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
  vi.mocked(recordUsage).mockReset().mockResolvedValue({ id: 'usage-row-123' });
  vi.mocked(logEvent).mockReset();
  vi.mocked(resolveModel).mockClear();
});

// --- Tests ---------------------------------------------------------------

describe('BrainExplore end-to-end', () => {
  it('returns ok with Sources-validated text', async () => {
    const res = await runSubagent(
      { parentCtx, parentUsageRecordId: 'parent-row-456' },
      {
        description: 'find pricing',
        subagent_type: 'BrainExplore',
        prompt: 'What is our pricing?',
      },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain('Sources');
    expect(res.text).toContain('slug:');
    expect(res.text).toContain('id:');
    expect(res.subagentType).toBe('BrainExplore');
    expect(res.usage).toMatchObject({
      inputTokens: 150,
      outputTokens: 60,
      totalTokens: 210,
      cachedInputTokens: 20,
    });
  });

  it('attributes usage with source=subagent and parent FK', async () => {
    await runSubagent(
      { parentCtx, parentUsageRecordId: 'parent-row-456' },
      {
        description: 'find pricing',
        subagent_type: 'BrainExplore',
        prompt: 'q',
      },
    );

    expect(recordUsage).toHaveBeenCalledTimes(1);
    const args = vi.mocked(recordUsage).mock.calls[0]?.[0];
    expect(args).toMatchObject({
      source: 'subagent',
      parentUsageRecordId: 'parent-row-456',
      modelId: 'anthropic/claude-haiku-4.5',
    });
  });

  it('emits an audit event with category agent and status ok', async () => {
    await runSubagent(
      { parentCtx, parentUsageRecordId: null },
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
        status: 'ok',
        subagentType: 'BrainExplore',
      }),
    });
  });
});

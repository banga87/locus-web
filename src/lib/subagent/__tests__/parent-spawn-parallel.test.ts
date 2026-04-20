import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext } from '@/lib/agent/types';

const runSubagentMock = vi.fn();
vi.mock('../runSubagent', () => ({
  runSubagent: (...args: unknown[]) => runSubagentMock(...args),
}));

// Import AFTER mocks so the mock is bound.
import { buildAgentTool } from '../AgentTool';

const parentCtx: AgentContext = {
  actor: { type: 'platform_agent', userId: 'u', companyId: 'c', scopes: ['read'] },
  brainId: 'b',
  companyId: 'c',
  sessionId: 's',
  abortSignal: new AbortController().signal,
  grantedCapabilities: [],
};

beforeEach(() => {
  runSubagentMock.mockReset().mockResolvedValue({
    ok: true,
    text: 'ok',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    subagentType: 'BrainExplore',
  });
});

describe('parent-turn subagent cap', () => {
  it('allows calls up to the cap limit and rejects any beyond', async () => {
    const cap = { limit: 3, count: 0 };
    const tool = buildAgentTool({
      parentCtx,
      getParentUsageRecordId: () => null,
      description: 'test',
      cap,
    });
    const execute = tool.execute as (i: unknown) => Promise<unknown>;
    const invocation = { description: 'find', subagent_type: 'BrainExplore', prompt: 'hi' };

    const [r1, r2, r3, r4] = await Promise.all([
      execute(invocation),
      execute(invocation),
      execute(invocation),
      execute(invocation),
    ]);

    const results = [r1, r2, r3, r4] as Array<{ ok: boolean; error?: string }>;
    const oks = results.filter((r) => r.ok).length;
    const fails = results.filter((r) => !r.ok);
    expect(oks).toBe(3);
    expect(fails).toHaveLength(1);
    expect(fails[0]?.error).toMatch(/cap of 3/);

    // runSubagent should only have been called 3 times (not 4).
    expect(runSubagentMock).toHaveBeenCalledTimes(3);
  });
});

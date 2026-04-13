// recordUsage cost-math tests. The DB insert is mocked because the only
// thing worth pinning down here is the cached vs uncached split + the
// 30% markup formula. The schema integration is exercised by the
// `usage_records` schema migration test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const insertCalls: Array<Record<string, unknown>> = [];

vi.mock('@/db', () => ({
  db: {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        insertCalls.push(row);
      },
    }),
  },
}));

import { recordUsage } from '../record';

beforeEach(() => {
  insertCalls.length = 0;
});

afterEach(() => {
  insertCalls.length = 0;
});

describe('usage/record — cost math', () => {
  it('charges all input tokens at the uncached rate when no cache is reported', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: 's1',
      userId: 'u1',
      modelId: 'anthropic/claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });

    expect(insertCalls).toHaveLength(1);
    const row = insertCalls[0]!;
    // 1000/1000 * 0.003 + 500/1000 * 0.015 = 0.003 + 0.0075 = 0.0105
    expect(row.providerCostUsd).toBeCloseTo(0.0105, 6);
    // customer = 0.0105 * 1.30 = 0.01365
    expect(row.customerCostUsd).toBeCloseTo(0.01365, 6);
  });

  it('splits cached vs uncached input and bills cached portion at the cached rate', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: 's1',
      userId: 'u1',
      modelId: 'anthropic/claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      cachedInputTokens: 800,
    });

    const row = insertCalls[0]!;
    // uncached: 200/1000 * 0.003   = 0.0006
    // cached:   800/1000 * 0.0003  = 0.00024
    // output:   500/1000 * 0.015   = 0.0075
    // provider: 0.0006 + 0.00024 + 0.0075 = 0.00834
    expect(row.providerCostUsd).toBeCloseTo(0.00834, 6);
    expect(row.customerCostUsd).toBeCloseTo(0.00834 * 1.3, 6);
    // metadata should record the cached count for downstream analytics.
    expect(row.metadata).toEqual({ cachedInputTokens: 800 });
  });

  it('records source=platform_agent and splits modelId into provider + model', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'anthropic/claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    const row = insertCalls[0]!;
    expect(row.source).toBe('platform_agent');
    expect(row.provider).toBe('anthropic');
    expect(row.model).toBe('claude-sonnet-4-6');
  });

  it('skips the insert and warns when the model id is unknown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'unknown/model',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    expect(insertCalls).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown model rates'),
    );
    warn.mockRestore();
  });

  it('clamps negative uncached input to zero when cachedInputTokens > inputTokens', async () => {
    // Defensive: the provider could theoretically over-report cache reads.
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'anthropic/claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 0,
      totalTokens: 100,
      cachedInputTokens: 200,
    });
    const row = insertCalls[0]!;
    // uncached portion clamped to 0; cached billed for 200 tokens.
    // 0 + 200/1000 * 0.0003 = 0.00006
    expect(row.providerCostUsd).toBeCloseTo(0.00006, 6);
  });
});

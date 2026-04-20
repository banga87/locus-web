// recordUsage cost-math tests. The DB insert is mocked because the only
// thing worth pinning down here is the cached vs uncached split + the
// 30% markup formula. The schema integration is exercised by the
// `usage_records` schema migration test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const insertCalls: Array<Record<string, unknown>> = [];
// Per-test override for the .returning() payload. Reset in beforeEach.
let returningRows: Array<Record<string, unknown>> = [{ id: 'mock-id' }];

vi.mock('@/db', () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        insertCalls.push(row);
        return {
          returning: async () => returningRows,
        };
      },
    }),
  },
}));

import { recordUsage } from '../record';

beforeEach(() => {
  insertCalls.length = 0;
  returningRows = [{ id: 'mock-id' }];
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

describe('usage/record — Haiku 4.5 rates', () => {
  it('prices Haiku input + output correctly with 30% markup', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'anthropic/claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });

    const row = insertCalls[insertCalls.length - 1]!;
    // Haiku rates: input 0.001, output 0.005 per 1K
    const expectedProvider = (1000 / 1000) * 0.001 + (500 / 1000) * 0.005;
    expect(row.providerCostUsd).toBeCloseTo(expectedProvider, 6);
    expect(row.customerCostUsd).toBeCloseTo(expectedProvider * 1.3, 6);
    expect(row.provider).toBe('anthropic');
    expect(row.model).toBe('claude-haiku-4-5-20251001');
  });
});

describe('usage/record — subagent attribution', () => {
  it('records source and parentUsageRecordId when supplied', async () => {
    const parentId = crypto.randomUUID();
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: 'u1',
      modelId: 'anthropic/claude-haiku-4.5',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      source: 'subagent',
      parentUsageRecordId: parentId,
    });
    const row = insertCalls[0]!;
    expect(row.source).toBe('subagent');
    expect(row.parentUsageRecordId).toBe(parentId);
  });

  it('defaults source to platform_agent and parentUsageRecordId to null when not supplied', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: 'u1',
      modelId: 'anthropic/claude-haiku-4.5',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    const row = insertCalls[0]!;
    expect(row.source).toBe('platform_agent');
    expect(row.parentUsageRecordId).toBeNull();
  });

  it('returns the inserted row id', async () => {
    returningRows = [{ id: 'generated-uuid' }];
    const result = await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: 'u1',
      modelId: 'anthropic/claude-haiku-4.5',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    expect(result).toEqual({ id: 'generated-uuid' });
  });

  it('returns null when the model id is unknown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'unknown/model',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    expect(result).toBeNull();
    warn.mockRestore();
  });
});

describe('usage/record — Gateway-format model rates', () => {
  it('prices anthropic/claude-haiku-4.5 correctly', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'anthropic/claude-haiku-4.5',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    const row = insertCalls[0]!;
    // input 0.001 / output 0.005 per 1K
    expect(row.providerCostUsd).toBeCloseTo(0.001 + 0.0025, 6);
    expect(row.provider).toBe('anthropic');
    expect(row.model).toBe('claude-haiku-4.5');
  });

  it('prices anthropic/claude-sonnet-4.6 correctly', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'anthropic/claude-sonnet-4.6',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    const row = insertCalls[0]!;
    expect(row.providerCostUsd).toBeCloseTo(0.003 + 0.0075, 6);
  });

  it('prices anthropic/claude-opus-4.7 correctly', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'anthropic/claude-opus-4.7',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    const row = insertCalls[0]!;
    // input 0.005 / output 0.025 per 1K
    expect(row.providerCostUsd).toBeCloseTo(0.005 + 0.0125, 6);
  });

  it('prices google/gemini-2.5-flash-lite correctly', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'google/gemini-2.5-flash-lite',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    const row = insertCalls[0]!;
    // input 0.0001 / output 0.0004 per 1K
    expect(row.providerCostUsd).toBeCloseTo(0.0001 + 0.0002, 6);
    expect(row.provider).toBe('google');
    expect(row.model).toBe('gemini-2.5-flash-lite');
  });

  it('prices google/gemini-2.5-flash correctly', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'google/gemini-2.5-flash',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    const row = insertCalls[0]!;
    // input 0.0003 / output 0.0025 per 1K
    expect(row.providerCostUsd).toBeCloseTo(0.0003 + 0.00125, 6);
  });

  it('prices google/gemini-2.5-pro correctly', async () => {
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      modelId: 'google/gemini-2.5-pro',
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    const row = insertCalls[0]!;
    // input 0.00125 / output 0.010 per 1K
    expect(row.providerCostUsd).toBeCloseTo(0.00125 + 0.005, 6);
  });
});

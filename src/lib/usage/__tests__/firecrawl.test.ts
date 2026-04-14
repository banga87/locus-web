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

import { recordFirecrawlUsage, FIRECRAWL_COST_PER_CREDIT_USD } from '../firecrawl';

beforeEach(() => { insertCalls.length = 0; });
afterEach(() => { insertCalls.length = 0; });

describe('usage/firecrawl — recordFirecrawlUsage', () => {
  it('writes one row with provider=firecrawl, tokens=0, 30% markup', async () => {
    await recordFirecrawlUsage({
      companyId: 'c1',
      sessionId: 's1',
      userId: 'u1',
      tool: 'web_fetch',
      credits: 1,
      url: 'https://example.com',
    });

    expect(insertCalls).toHaveLength(1);
    const row = insertCalls[0]!;
    expect(row.provider).toBe('firecrawl');
    expect(row.model).toBeNull();
    expect(row.inputTokens).toBe(0);
    expect(row.outputTokens).toBe(0);
    expect(row.totalTokens).toBe(0);
    expect(row.source).toBe('platform_agent');
    const expectedProvider = 1 * FIRECRAWL_COST_PER_CREDIT_USD;
    expect(row.providerCostUsd).toBeCloseTo(expectedProvider, 8);
    expect(row.customerCostUsd).toBeCloseTo(expectedProvider * 1.3, 8);
    expect(row.metadata).toMatchObject({
      tool: 'web_fetch',
      credits: 1,
      url: 'https://example.com',
    });
  });

  it('omits url from metadata for web_search (no URL at search time)', async () => {
    await recordFirecrawlUsage({
      companyId: 'c1',
      sessionId: null,
      userId: null,
      tool: 'web_search',
      credits: 1,
    });

    const row = insertCalls[0]!;
    expect((row.metadata as Record<string, unknown>).tool).toBe('web_search');
    expect((row.metadata as Record<string, unknown>).url).toBeUndefined();
  });

  it('never throws on DB failure — logs and returns', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.doMock('@/db', () => ({
      db: { insert: () => ({ values: async () => { throw new Error('boom'); } }) },
    }));
    vi.resetModules();
    const { recordFirecrawlUsage: isolated } = await import('../firecrawl');
    await expect(
      isolated({ companyId: 'c1', sessionId: null, userId: null, tool: 'web_search', credits: 1 }),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    vi.doUnmock('@/db');
  });
});

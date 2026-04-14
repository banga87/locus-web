import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { searchMock, recordMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
  recordMock: vi.fn(),
}));
vi.mock('@/lib/webfetch/firecrawl-client', () => ({ search: searchMock }));
vi.mock('@/lib/usage/firecrawl', () => ({ recordFirecrawlUsage: recordMock }));

import { webSearchTool } from '../implementations/web-search';
import type { ToolContext } from '../types';

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    actor: { type: 'human', id: 'u1', scopes: ['read'] },
    companyId: 'c1',
    brainId: 'b1',
    sessionId: 's1',
    grantedCapabilities: ['web'],
    webCallsThisTurn: 0,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

beforeEach(() => {
  searchMock.mockReset();
  recordMock.mockReset();
  process.env.FIRECRAWL_ENABLED = 'true';
});

afterEach(() => { delete process.env.FIRECRAWL_ENABLED; });

describe('web_search tool', () => {
  it('declares capabilities: ["web"]', () => {
    expect(webSearchTool.capabilities).toEqual(['web']);
  });

  it('returns results on success and records usage', async () => {
    searchMock.mockResolvedValueOnce({
      kind: 'ok',
      results: [{ url: 'https://a.com', title: 'A', snippet: 's' }],
    });
    const c = ctx();
    const result = await webSearchTool.call({ query: 'x', limit: 5 }, c);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      results: [{ url: 'https://a.com', title: 'A', snippet: 's' }],
    });
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'web_search',
      credits: 1,
      companyId: 'c1',
    }));
    expect(c.webCallsThisTurn).toBe(1);
  });

  it('short-circuits with disabled when FIRECRAWL_ENABLED=false', async () => {
    process.env.FIRECRAWL_ENABLED = 'false';
    const result = await webSearchTool.call({ query: 'x', limit: 5 }, ctx());
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('disabled');
    expect(searchMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('short-circuits with per_turn_limit_exceeded on the 16th call', async () => {
    const c = ctx({ webCallsThisTurn: 15 });
    const result = await webSearchTool.call({ query: 'x', limit: 5 }, c);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('per_turn_limit_exceeded');
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('maps rate_limited outcome to rate_limited error envelope', async () => {
    searchMock.mockResolvedValueOnce({ kind: 'rate_limited' });
    const result = await webSearchTool.call({ query: 'x', limit: 5 }, ctx());
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('rate_limited');
    expect(result.error?.retryable).toBe(true);
  });

  it('default limit is 5', async () => {
    searchMock.mockResolvedValueOnce({ kind: 'ok', results: [] });
    await webSearchTool.call({ query: 'x' }, ctx());
    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
  });
});

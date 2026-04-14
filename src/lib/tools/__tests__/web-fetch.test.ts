import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { scrapeMock, extractMock, recordFirecrawlMock, recordUsageMock } = vi.hoisted(() => ({
  scrapeMock: vi.fn(),
  extractMock: vi.fn(),
  recordFirecrawlMock: vi.fn(),
  recordUsageMock: vi.fn(),
}));

vi.mock('@/lib/webfetch/firecrawl-client', () => ({ scrape: scrapeMock }));
vi.mock('@/lib/webfetch/extractor', () => ({
  extract: extractMock,
  HAIKU_MODEL_ID: 'claude-haiku-4-5-20251001',
}));
vi.mock('@/lib/usage/firecrawl', () => ({ recordFirecrawlUsage: recordFirecrawlMock }));
vi.mock('@/lib/usage/record', () => ({ recordUsage: recordUsageMock }));

import { webFetchTool, TRUNCATE_THRESHOLD_CHARS, REJECT_THRESHOLD_CHARS } from '../implementations/web-fetch';
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
  scrapeMock.mockReset();
  extractMock.mockReset();
  recordFirecrawlMock.mockReset();
  recordUsageMock.mockReset();
  process.env.FIRECRAWL_ENABLED = 'true';
});

afterEach(() => { delete process.env.FIRECRAWL_ENABLED; });

describe('web_fetch tool', () => {
  it('declares capabilities: ["web"]', () => {
    expect(webFetchTool.capabilities).toEqual(['web']);
  });

  it('happy path: scrape -> extract -> 2 usage rows -> compressed output', async () => {
    scrapeMock.mockResolvedValueOnce({
      kind: 'ok', markdown: '# Title\n\nbody', title: 'Title',
    });
    extractMock.mockResolvedValueOnce({
      kind: 'ok', text: 'compressed',
      usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500 },
    });

    const c = ctx();
    const result = await webFetchTool.call(
      { url: 'https://example.com', prompt: 'extract the heading here please' },
      c,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      url: 'https://example.com',
      title: 'Title',
      extracted: 'compressed',
    });
    expect(c.webCallsThisTurn).toBe(1);
    expect(recordFirecrawlMock).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'web_fetch', credits: 1, url: 'https://example.com',
    }));
    expect(recordUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'anthropic/claude-haiku-4-5-20251001',
      inputTokens: 400, outputTokens: 100, totalTokens: 500,
    }));
  });

  it('rejects non-http(s) urls with invalid_url', async () => {
    const r = await webFetchTool.call({ url: 'file:///etc/passwd', prompt: 'xxxxxxxxxx' }, ctx());
    expect(r.error?.code).toBe('invalid_url');
    expect(scrapeMock).not.toHaveBeenCalled();
  });

  it('truncates markdown > TRUNCATE_THRESHOLD_CHARS and appends marker', async () => {
    const huge = 'a'.repeat(TRUNCATE_THRESHOLD_CHARS + 10_000);
    scrapeMock.mockResolvedValueOnce({ kind: 'ok', markdown: huge });
    extractMock.mockResolvedValueOnce({
      kind: 'ok', text: 'compressed',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
    await webFetchTool.call({ url: 'https://example.com', prompt: 'xxxxxxxxxx' }, ctx());
    const passed = extractMock.mock.calls[0][0].markdown as string;
    expect(passed.length).toBeLessThanOrEqual(TRUNCATE_THRESHOLD_CHARS + 100);
    expect(passed).toContain('[...content truncated...]');
  });

  it('rejects markdown > REJECT_THRESHOLD_CHARS with content_too_large', async () => {
    const gigantic = 'a'.repeat(REJECT_THRESHOLD_CHARS + 1_000);
    scrapeMock.mockResolvedValueOnce({ kind: 'ok', markdown: gigantic });
    const r = await webFetchTool.call({ url: 'https://example.com', prompt: 'xxxxxxxxxx' }, ctx());
    expect(r.error?.code).toBe('content_too_large');
    expect(extractMock).not.toHaveBeenCalled();
    // Firecrawl credit still spent — record it.
    expect(recordFirecrawlMock).toHaveBeenCalled();
  });

  it('maps extractor failure to extraction_failed and still records firecrawl credit', async () => {
    scrapeMock.mockResolvedValueOnce({ kind: 'ok', markdown: 'body' });
    extractMock.mockResolvedValueOnce({ kind: 'extraction_failed', message: 'LLM down' });
    const r = await webFetchTool.call({ url: 'https://example.com', prompt: 'xxxxxxxxxx' }, ctx());
    expect(r.error?.code).toBe('extraction_failed');
    expect(recordFirecrawlMock).toHaveBeenCalled();
    expect(recordUsageMock).not.toHaveBeenCalled();
  });

  it('maps scrape_failed to scrape_failed envelope; no credit recorded', async () => {
    scrapeMock.mockResolvedValueOnce({ kind: 'scrape_failed', message: '403' });
    const r = await webFetchTool.call({ url: 'https://example.com', prompt: 'xxxxxxxxxx' }, ctx());
    expect(r.error?.code).toBe('scrape_failed');
    expect(recordFirecrawlMock).not.toHaveBeenCalled();
  });

  it('short-circuits with disabled when FIRECRAWL_ENABLED=false', async () => {
    process.env.FIRECRAWL_ENABLED = 'false';
    const r = await webFetchTool.call({ url: 'https://example.com', prompt: 'xxxxxxxxxx' }, ctx());
    expect(r.error?.code).toBe('disabled');
    expect(scrapeMock).not.toHaveBeenCalled();
  });

  it('short-circuits with per_turn_limit_exceeded on the 16th call', async () => {
    const c = ctx({ webCallsThisTurn: 15 });
    const r = await webFetchTool.call({ url: 'https://example.com', prompt: 'xxxxxxxxxx' }, c);
    expect(r.error?.code).toBe('per_turn_limit_exceeded');
    expect(scrapeMock).not.toHaveBeenCalled();
  });
});

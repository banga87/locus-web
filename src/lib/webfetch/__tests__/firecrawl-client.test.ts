import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchMock = vi.fn();
const scrapeMock = vi.fn();

// Firecrawl-js exports `Firecrawl` as default. Our wrapper does `new Firecrawl({...})`.
// Use `function` (not arrow) in mockImplementation so `new` works.
vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(function MockFirecrawl() {
    return { search: searchMock, scrape: scrapeMock };
  }),
  // Also export `Firecrawl` named (harmless redundancy).
  Firecrawl: vi.fn().mockImplementation(function MockFirecrawl() {
    return { search: searchMock, scrape: scrapeMock };
  }),
}));

import { search, scrape, __resetFirecrawlClientForTests } from '../firecrawl-client';

beforeEach(() => {
  searchMock.mockReset();
  scrapeMock.mockReset();
  __resetFirecrawlClientForTests();
  process.env.FIRECRAWL_API_KEY = 'fc-test';
});

afterEach(() => {
  delete process.env.FIRECRAWL_API_KEY;
});

describe('firecrawl-client — search', () => {
  it('passes query + limit + sources=[web], returns normalized results', async () => {
    // SDK returns SearchData directly — NOT { success, data }.
    searchMock.mockResolvedValueOnce({
      web: [
        { url: 'https://a.com', title: 'A', description: 'snippet A' },
        { url: 'https://b.com', title: 'B', description: 'snippet B' },
      ],
    });

    const out = await search({ query: 'firecrawl pricing', limit: 5 });
    expect(searchMock).toHaveBeenCalledWith('firecrawl pricing', expect.objectContaining({
      limit: 5,
      sources: ['web'],
    }));
    expect(out).toEqual({
      kind: 'ok',
      results: [
        { url: 'https://a.com', title: 'A', snippet: 'snippet A' },
        { url: 'https://b.com', title: 'B', snippet: 'snippet B' },
      ],
    });
  });

  it('returns kind=ok with empty results when SearchData.web is absent', async () => {
    searchMock.mockResolvedValueOnce({});
    const out = await search({ query: 'x', limit: 3 });
    expect(out).toEqual({ kind: 'ok', results: [] });
  });

  it('returns kind=rate_limited on status 429', async () => {
    // SdkError-shaped throw: { status: 429 }
    searchMock.mockRejectedValueOnce(Object.assign(new Error('Rate limited'), { status: 429 }));
    const out = await search({ query: 'x', limit: 3 });
    expect(out.kind).toBe('rate_limited');
  });

  it('returns kind=provider_error on status 502', async () => {
    searchMock.mockRejectedValueOnce(Object.assign(new Error('Server error'), { status: 502 }));
    const out = await search({ query: 'x', limit: 3 });
    expect(out.kind).toBe('provider_error');
  });

  it('returns kind=network_error when status is absent', async () => {
    searchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const out = await search({ query: 'x', limit: 3 });
    expect(out.kind).toBe('network_error');
  });
});

describe('firecrawl-client — scrape', () => {
  it('passes formats=[markdown] + onlyMainContent=true and normalizes the Document', async () => {
    // SDK returns Document directly — NOT { success, data }.
    scrapeMock.mockResolvedValueOnce({
      markdown: '# Hello\n\nworld',
      metadata: { title: 'Hello', sourceURL: 'https://example.com' },
    });

    const ac = new AbortController();
    const out = await scrape({ url: 'https://example.com', signal: ac.signal });
    expect(scrapeMock).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    );
    // SDK has no `signal` option in ScrapeOptions — wrapper must NOT pass it.
    expect(scrapeMock.mock.calls[0][1]).not.toHaveProperty('signal');
    expect(out).toEqual({
      kind: 'ok',
      markdown: '# Hello\n\nworld',
      title: 'Hello',
    });
  });

  it('returns kind=scrape_failed when Document has no markdown', async () => {
    scrapeMock.mockResolvedValueOnce({ metadata: { error: 'Blocked' } });
    const out = await scrape({ url: 'https://example.com', signal: new AbortController().signal });
    expect(out.kind).toBe('scrape_failed');
  });

  it('returns kind=scrape_failed when SdkError has status 403 or 422', async () => {
    scrapeMock.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const out = await scrape({ url: 'https://example.com', signal: new AbortController().signal });
    expect(out.kind).toBe('scrape_failed');
  });

  it('returns kind=rate_limited on 429', async () => {
    scrapeMock.mockRejectedValueOnce(Object.assign(new Error('Rate'), { status: 429 }));
    const out = await scrape({ url: 'https://example.com', signal: new AbortController().signal });
    expect(out.kind).toBe('rate_limited');
  });

  it('returns kind=provider_error on 5xx', async () => {
    scrapeMock.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }));
    const out = await scrape({ url: 'https://example.com', signal: new AbortController().signal });
    expect(out.kind).toBe('provider_error');
  });
});

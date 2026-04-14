import Firecrawl from '@mendable/firecrawl-js';
import type { SearchOutcome, ScrapeOutcome } from './types';

let client: Firecrawl | null = null;

function getClient(): Firecrawl {
  if (!client) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set');
    client = new Firecrawl({ apiKey });
  }
  return client;
}

interface SearchArgs {
  query: string;
  limit: number;
}

export async function search(args: SearchArgs): Promise<SearchOutcome> {
  try {
    const data = await getClient().search(args.query, {
      limit: args.limit,
      sources: ['web'],
    });
    const web = Array.isArray(data.web) ? data.web : [];
    const results = web.map((r) => {
      // SearchData.web is `Array<SearchResultWeb | Document>`. SearchResultWeb has
      // .description; Document does not. Both expose .url and .title via different
      // paths. Narrow defensively so the consumer always gets { url, title, snippet }.
      const rec = r as Record<string, unknown>;
      const meta = (rec.metadata ?? undefined) as Record<string, unknown> | undefined;
      const url = typeof rec.url === 'string' ? rec.url : '';
      const title =
        typeof rec.title === 'string'
          ? rec.title
          : meta && typeof meta.title === 'string'
            ? meta.title
            : '';
      const snippet =
        typeof rec.description === 'string'
          ? rec.description
          : meta && typeof meta.description === 'string'
            ? meta.description
            : '';
      return { url, title, snippet };
    });
    return { kind: 'ok', results };
  } catch (err) {
    return categorizeSearchError(err);
  }
}

interface ScrapeArgs {
  url: string;
  // AbortSignal is currently unused by the SDK's ScrapeOptions, but we
  // accept it here so Task 8's withTimeout wrapper can still abort the
  // surrounding promise. The SDK call itself won't honour it today.
  signal: AbortSignal;
}

export async function scrape(args: ScrapeArgs): Promise<ScrapeOutcome> {
  try {
    const doc = await getClient().scrape(args.url, {
      formats: ['markdown'],
      onlyMainContent: true,
    });
    const markdown = typeof doc.markdown === 'string' ? doc.markdown : '';
    const title =
      doc.metadata && typeof doc.metadata.title === 'string' ? doc.metadata.title : undefined;
    if (!markdown) {
      const errMsg =
        doc.metadata && typeof doc.metadata.error === 'string'
          ? doc.metadata.error
          : 'Empty markdown';
      return { kind: 'scrape_failed', message: errMsg };
    }
    return { kind: 'ok', markdown, title };
  } catch (err) {
    return categorizeScrapeError(err);
  }
}

function categorizeSearchError(err: unknown): SearchOutcome {
  const e = err as { status?: number; message?: string };
  if (e.status === 429) return { kind: 'rate_limited' };
  if (typeof e.status === 'number' && e.status >= 500) {
    return { kind: 'provider_error', message: e.message ?? `Firecrawl ${e.status}` };
  }
  return { kind: 'network_error', message: e.message ?? 'Unknown error' };
}

function categorizeScrapeError(err: unknown): ScrapeOutcome {
  const e = err as { status?: number; message?: string };
  if (e.status === 429) return { kind: 'rate_limited' };
  if (typeof e.status === 'number' && e.status >= 500) {
    return { kind: 'provider_error', message: e.message ?? `Firecrawl ${e.status}` };
  }
  if (typeof e.status === 'number' && e.status >= 400) {
    // 4xx (excluding 429 handled above) means the page couldn't be scraped
    // — blocked, auth-required, forbidden, etc. Treat as scrape_failed.
    return { kind: 'scrape_failed', message: e.message ?? `Firecrawl ${e.status}` };
  }
  return { kind: 'network_error', message: e.message ?? 'Unknown error' };
}

/** Test hook: reset the memoised client so tests can re-init with a new key. */
export function __resetFirecrawlClientForTests(): void {
  client = null;
}

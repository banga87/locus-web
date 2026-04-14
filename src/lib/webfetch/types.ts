// Provider-agnostic outcome unions for Firecrawl. Callers (web_search,
// web_fetch) switch on `kind` — they never see @mendable/firecrawl-js
// directly.

export interface SearchResultItem {
  url: string;
  title: string;
  snippet: string;
}

export type SearchOutcome =
  | { kind: 'ok'; results: SearchResultItem[] }
  | { kind: 'rate_limited' }
  | { kind: 'provider_error'; message: string }
  | { kind: 'network_error'; message: string };

export type ScrapeOutcome =
  | { kind: 'ok'; markdown: string; title?: string }
  | { kind: 'scrape_failed'; message: string }
  | { kind: 'rate_limited' }
  | { kind: 'provider_error'; message: string }
  | { kind: 'network_error'; message: string };

// Consumed by Task 6's extractor, re-exported here so callers have one
// import surface for webfetch contracts.
export interface ExtractResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

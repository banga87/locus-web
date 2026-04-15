/**
 * Extract outbound links from document markdown content.
 *
 * Supported link forms:
 *   - Wikilinks: `[[target-slug]]` or `[[target-slug|display text]]`
 *   - Markdown links with relative paths: `[text](/some-slug)`
 *
 * Skipped:
 *   - External URLs: `[Google](https://…)`, `[x](mailto:…)`, `[x](tel:…)`
 *   - Anchor-only links: `[x](#heading)`
 *   - Image links: `![alt](path)` — images aren't doc-to-doc links
 *
 * Results are deduplicated by (target_slug, source) pair.
 *
 * See spec §7 Migration 3 — `documents.metadata.outbound_links`.
 */

export interface OutboundLink {
  target_slug: string;
  source: 'wikilink' | 'markdown_link';
  raw: string;
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const MARKDOWN_LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;

export function parseOutboundLinks(content: string): OutboundLink[] {
  if (!content) return [];

  const links: OutboundLink[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(WIKILINK_RE)) {
    const slug = match[1].trim();
    if (!slug) continue;
    const key = `wikilink|${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      target_slug: slug,
      source: 'wikilink',
      raw: match[0],
    });
  }

  for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
    const href = match[2].trim();
    if (!href.startsWith('/')) continue;
    const slug = href.replace(/^\/+|\/+$/g, '').split('/').pop();
    if (!slug) continue;
    const key = `markdown_link|${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      target_slug: slug,
      source: 'markdown_link',
      raw: match[0],
    });
  }

  return links;
}

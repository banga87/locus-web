import { describe, it, expect } from 'vitest';
import { parseOutboundLinks } from '../markdown-links';

describe('parseOutboundLinks', () => {
  it('returns empty array for docs with no links', () => {
    expect(parseOutboundLinks('Plain text, no links.')).toEqual([]);
  });

  it('extracts a single wikilink', () => {
    const result = parseOutboundLinks('See [[brand-voice]] for more.');
    expect(result).toEqual([
      { target_slug: 'brand-voice', source: 'wikilink', raw: '[[brand-voice]]' },
    ]);
  });

  it('extracts a markdown link with a slug-like path', () => {
    const result = parseOutboundLinks('Read the [brand voice guide](/brand-voice).');
    expect(result).toEqual([
      { target_slug: 'brand-voice', source: 'markdown_link', raw: '[brand voice guide](/brand-voice)' },
    ]);
  });

  it('ignores external markdown links', () => {
    expect(parseOutboundLinks('[Google](https://google.com)')).toEqual([]);
    expect(parseOutboundLinks('[mailto](mailto:foo@bar.com)')).toEqual([]);
  });

  it('handles nested wikilinks with display text', () => {
    const result = parseOutboundLinks('See [[brand-voice|our voice]].');
    expect(result).toEqual([
      { target_slug: 'brand-voice', source: 'wikilink', raw: '[[brand-voice|our voice]]' },
    ]);
  });

  it('deduplicates links to the same target from the same content', () => {
    const result = parseOutboundLinks('[[brand-voice]] and later [[brand-voice]] again.');
    expect(result).toHaveLength(1);
  });

  it('extracts multiple distinct links', () => {
    const content = 'See [[brand-voice]] and the [pricing](/pricing-tiers) page.';
    const result = parseOutboundLinks(content);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.target_slug).sort()).toEqual(['brand-voice', 'pricing-tiers']);
  });

  it('strips leading and trailing slashes from markdown paths', () => {
    expect(parseOutboundLinks('[x](/foo/)')).toEqual([
      { target_slug: 'foo', source: 'markdown_link', raw: '[x](/foo/)' },
    ]);
  });
});

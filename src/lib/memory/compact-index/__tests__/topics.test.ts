import { describe, it, expect } from 'vitest';
import { extractTopics } from '../topics';

describe('extractTopics', () => {
  it('ranks by normalized frequency and excludes stopwords', () => {
    const content =
      'enterprise enterprise enterprise pricing pricing the the the the a a a';
    expect(extractTopics(content).slice(0, 2)).toEqual([
      'enterprise',
      'pricing',
    ]);
  });

  it('normalizes to lowercase', () => {
    const content = 'Pricing Pricing Pricing enterprise enterprise';
    expect(extractTopics(content)).toContain('pricing');
    expect(extractTopics(content)).toContain('enterprise');
  });

  it('caps at 8 entries', () => {
    const content = Array.from({ length: 20 }, (_, i) => `word${i} `.repeat(5))
      .join(' ');
    expect(extractTopics(content).length).toBeLessThanOrEqual(8);
  });

  it('returns empty on empty input', () => {
    expect(extractTopics('')).toEqual([]);
  });

  it('ignores short tokens (<3 chars)', () => {
    expect(extractTopics('ab ab ab pricing pricing pricing')).toEqual([
      'pricing',
    ]);
  });
});

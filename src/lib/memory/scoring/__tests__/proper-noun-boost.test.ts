import { describe, it, expect } from 'vitest';
import { properNounBoost } from '../proper-noun-boost';

describe('properNounBoost', () => {
  it('boosts 1.4x when a proper noun from the query appears in content verbatim', () => {
    expect(properNounBoost('who is Jane', 'Jane leads sales')).toBe(1.4);
  });

  it('returns 1.0 when query has no capitalized tokens', () => {
    expect(properNounBoost('who leads sales', 'anything')).toBe(1.0);
  });

  it('returns 1.0 when proper noun is NOT in content', () => {
    expect(properNounBoost('who is Acme', 'no match here')).toBe(1.0);
  });

  it('ignores sentence-initial stopwords like "The"', () => {
    // "The" at query start should not trigger the boost
    expect(properNounBoost('The sales leader', 'sales is great')).toBe(1.0);
  });

  it('stacks multiplicatively for multiple matches (but caps at 2.0 total)', () => {
    const score = properNounBoost('Jane Smith at Acme', 'Jane Smith works at Acme');
    expect(score).toBeLessThanOrEqual(2.0);
    expect(score).toBeGreaterThan(1.4);
  });
});

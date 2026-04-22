import { describe, it, expect } from 'vitest';
import { phraseBoost } from '../phrase-boost';

describe('phraseBoost', () => {
  it('returns 1.6 when content contains the quoted phrase', () => {
    expect(phraseBoost('"quoted phrase" other', 'this quoted phrase here')).toBe(1.6);
  });

  it('returns 1.0 when there are no quoted phrases in the query', () => {
    expect(phraseBoost('plain query', 'any content')).toBe(1.0);
  });

  it('returns 1.0 when quoted phrase is NOT in the content', () => {
    expect(phraseBoost('"missing"', 'other content')).toBe(1.0);
  });

  it('stacks multiplicatively for multiple phrases', () => {
    const score = phraseBoost('"one" "two"', 'one two both here');
    expect(score).toBeCloseTo(1.6 * 1.6);
  });

  it('is case-insensitive on the match', () => {
    expect(phraseBoost('"Acme Corp"', 'acme corp rocks')).toBe(1.6);
  });
});

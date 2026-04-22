import { describe, it, expect } from 'vitest';
import { extractKeySentence } from '../key-sentence';

describe('extractKeySentence', () => {
  it('returns the first sentence containing a decision word', () => {
    const content =
      'This is boring intro text.\n\nWe decided to use GraphQL instead of REST. Further prose.';
    expect(extractKeySentence(content)).toBe(
      'We decided to use GraphQL instead of REST.',
    );
  });

  it('falls back to first substantial (>=12 tokens) sentence if no decision words', () => {
    const content =
      'Short. This sentence has more than twelve tokens and should be chosen as the key one.';
    expect(extractKeySentence(content)).toBe(
      'This sentence has more than twelve tokens and should be chosen as the key one.',
    );
  });

  it('truncates at 200 chars', () => {
    const long = 'We decided ' + 'x'.repeat(300) + '.';
    const out = extractKeySentence(long);
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it('returns empty string when no qualifying sentence exists', () => {
    expect(extractKeySentence('Hi. Ok. Maybe.')).toBe('');
  });

  it('strips markdown syntax from the returned sentence', () => {
    const content = '**We decided** to use GraphQL.';
    expect(extractKeySentence(content)).toBe('We decided to use GraphQL.');
  });
});

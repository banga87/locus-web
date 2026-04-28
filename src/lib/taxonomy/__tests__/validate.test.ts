import { describe, expect, it } from 'vitest';
import { validateTopics } from '../validate';

const vocab = {
  terms: ['brand', 'voice', 'pricing', 'customer'],
  synonyms: { users: 'customer' as const },
  version: 1,
};

describe('validateTopics', () => {
  it('accepts only canonical terms', () => {
    const result = validateTopics(['brand', 'voice'], vocab);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.canonical).toEqual(['brand', 'voice']);
  });

  it('reports synonym → canonical hint when alias used', () => {
    const result = validateTopics(['users'], vocab);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected).toEqual([
        { topic: 'users', synonymOf: 'customer' },
      ]);
    }
  });

  it('reports a bare rejection when nothing matches', () => {
    const result = validateTopics(['novel'], vocab);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected).toEqual([{ topic: 'novel', synonymOf: null }]);
    }
  });

  it('handles mixed valid + invalid in one pass', () => {
    const result = validateTopics(['brand', 'novel'], vocab);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected.map((r) => r.topic)).toEqual(['novel']);
    }
  });

  it('rejects empty array as 0-of-1-to-5', () => {
    const result = validateTopics([], vocab);
    expect(result.ok).toBe(false);
  });

  it('rejects more than 5', () => {
    const result = validateTopics(
      ['brand', 'voice', 'pricing', 'customer', 'brand', 'voice'],
      vocab,
    );
    expect(result.ok).toBe(false);
  });
});

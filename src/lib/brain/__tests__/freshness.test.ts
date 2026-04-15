// Staleness tier boundaries — confidence-weighted. High-confidence docs age
// slower than low-confidence. See `src/lib/brain/freshness.ts` for thresholds.
//
// `now` is fixed so the math is deterministic regardless of real-world clock.
// `daysAgo(n)` returns the ISO string of an update `n` days before `now`, so
// each test row asserts exactly the tier boundary behaviour.

import { describe, it, expect } from 'vitest';
import { getFreshness } from '../freshness';

const now = new Date('2026-04-15T00:00:00Z');
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 86400_000).toISOString();

describe('getFreshness', () => {
  it.each([
    ['high', 29, 'fresh'],
    ['high', 89, 'fresh'],
    ['high', 90, 'aging'],
    ['high', 179, 'aging'],
    ['high', 180, 'stale'],
    ['medium', 59, 'fresh'],
    ['medium', 60, 'aging'],
    ['medium', 120, 'stale'],
    ['low', 29, 'fresh'],
    ['low', 30, 'aging'],
    ['low', 60, 'stale'],
  ] as const)(
    'confidence=%s age=%i days → %s',
    (confidence, age, expected) => {
      expect(getFreshness(daysAgo(age), confidence, now)).toBe(expected);
    },
  );

  it('defaults to medium tier if confidence is missing', () => {
    expect(getFreshness(daysAgo(59), undefined, now)).toBe('fresh');
    expect(getFreshness(daysAgo(60), undefined, now)).toBe('aging');
  });
});

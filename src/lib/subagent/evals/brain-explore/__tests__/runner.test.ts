import { describe, it, expect } from 'vitest';
import {
  aggregate,
  computeSourceCompleteness,
  extractSlugsFromText,
} from '../runner';

describe('computeSourceCompleteness', () => {
  it('returns 1 when all expected slugs are present', () => {
    expect(computeSourceCompleteness(['a', 'b'], ['a', 'b', 'c'])).toBe(1);
  });

  it('returns the hit fraction when partial', () => {
    expect(computeSourceCompleteness(['a', 'b', 'c'], ['a'])).toBeCloseTo(
      1 / 3,
    );
  });

  it('returns 0 when none match', () => {
    expect(computeSourceCompleteness(['a', 'b'], ['x', 'y'])).toBe(0);
  });

  it('returns 1 when expected is empty (trivially complete)', () => {
    expect(computeSourceCompleteness([], ['x'])).toBe(1);
  });
});

describe('extractSlugsFromText', () => {
  it('extracts backtick-wrapped slug tokens', () => {
    const txt =
      '- Foo — slug: `foo` — id: `u1`\n- Bar — slug: `bar` — id: `u2`';
    expect(extractSlugsFromText(txt)).toEqual(['foo', 'bar']);
  });

  it('returns empty when no slugs present', () => {
    expect(extractSlugsFromText('no sources here')).toEqual([]);
  });
});

describe('aggregate', () => {
  it('returns zeros for empty input', () => {
    expect(aggregate([])).toEqual({
      count: 0,
      avgSourceCompleteness: 0,
      formatValidRate: 0,
      avgToolCalls: 0,
      avgLatencyMs: 0,
    });
  });

  it('averages across entries', () => {
    const agg = aggregate([
      {
        id: 'a',
        sourceCompleteness: 1.0,
        formatValid: 1,
        toolCallCount: 2,
        latencyMs: 100,
      },
      {
        id: 'b',
        sourceCompleteness: 0.5,
        formatValid: 1,
        toolCallCount: 4,
        latencyMs: 300,
      },
    ]);
    expect(agg.count).toBe(2);
    expect(agg.avgSourceCompleteness).toBeCloseTo(0.75);
    expect(agg.formatValidRate).toBe(1);
    expect(agg.avgToolCalls).toBe(3);
    expect(agg.avgLatencyMs).toBe(200);
  });
});

import { describe, it, expect } from 'vitest';
import { extractDateHints } from '../date-hints';

describe('extractDateHints', () => {
  it('extracts ISO-8601 date strings', () => {
    expect(extractDateHints('Released on 2026-04-22.')).toEqual(['2026-04-22']);
  });

  it('extracts multiple dates', () => {
    const content = 'Signed 2026-01-15 and renewed 2027-01-15.';
    expect(extractDateHints(content)).toEqual(['2026-01-15', '2027-01-15']);
  });

  it('deduplicates', () => {
    expect(extractDateHints('2026-04-22 and 2026-04-22')).toEqual([
      '2026-04-22',
    ]);
  });

  it('ignores invalid date-looking strings', () => {
    expect(extractDateHints('2026-13-45')).toEqual([]);
    expect(extractDateHints('2026-04-32')).toEqual([]);
  });

  it('caps at 10 entries', () => {
    const content = Array.from(
      { length: 20 },
      (_, i) => `2026-04-${String(i + 1).padStart(2, '0')}`,
    ).join(' ');
    expect(extractDateHints(content)).toHaveLength(10);
  });
});

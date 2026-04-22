import { describe, it, expect } from 'vitest';
import { extractProperNouns } from '../proper-nouns';

describe('extractProperNouns', () => {
  it('extracts single capitalized tokens', () => {
    expect(extractProperNouns('Acme owns Widget.')).toEqual(['Acme', 'Widget']);
  });

  it('extracts multi-word proper nouns', () => {
    expect(extractProperNouns('Jane Smith joined Acme Corp today.')).toEqual([
      'Jane Smith',
      'Acme Corp',
    ]);
  });

  it('skips sentence-initial non-proper words', () => {
    // "The" and "Today" at sentence start are common-case stopwords.
    expect(
      extractProperNouns('The team met with Acme. Today we signed.'),
    ).toEqual(['Acme']);
  });

  it('deduplicates', () => {
    expect(extractProperNouns('Acme Acme Acme')).toEqual(['Acme']);
  });

  it('caps at 20 entries', () => {
    const content = Array.from({ length: 30 }, (_, i) => `Name${i}`).join(' ');
    expect(extractProperNouns(content)).toHaveLength(20);
  });

  it('returns empty on empty input', () => {
    expect(extractProperNouns('')).toEqual([]);
  });

  it('ignores ALLCAPS tokens', () => {
    expect(extractProperNouns('API HTTP GET Request')).toEqual(['Request']);
  });
});

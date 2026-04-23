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

  it('deduplicates across mentions', () => {
    // Separate sentences so the multi-word chain doesn't fold them
    // into one phrase like 'Acme Acme Acme'.
    expect(extractProperNouns('Acme grew. Acme shipped. Acme rules.'))
      .toEqual(['Acme']);
  });

  it('caps at 20 entries', () => {
    // 30 distinct proper-noun-shaped tokens separated by a lowercase
    // delimiter so each is its own regex match (the multi-word chain
    // would otherwise concatenate adjacent capitalized words).
    const names = [
      'Acme', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot',
      'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima',
      'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo',
      'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'Xerox',
      'Yankee', 'Zulu', 'Alphabet', 'Bayer', 'Citroen', 'Daimler',
    ];
    const content = names.join(' visited ');
    expect(extractProperNouns(content)).toHaveLength(20);
  });

  it('returns empty on empty input', () => {
    expect(extractProperNouns('')).toEqual([]);
  });

  it('ignores ALLCAPS tokens', () => {
    expect(extractProperNouns('API HTTP GET Request')).toEqual(['Request']);
  });
});

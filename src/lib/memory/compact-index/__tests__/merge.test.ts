import { describe, it, expect } from 'vitest';
import { mergeCompactIndex } from '../merge';
import type { CompactIndex } from '../types';

function base(authored_by: CompactIndex['authored_by']): CompactIndex {
  return {
    entities: [],
    topics: [],
    flags: [],
    proper_nouns: [],
    key_sentence: '',
    date_hints: [],
    authored_by,
    computed_at: '2026-04-22T12:00:00.000Z',
  };
}

describe('mergeCompactIndex', () => {
  it('human beats generating_agent beats maintenance beats rule_based', () => {
    const rb = { ...base('rule_based'), topics: ['rb-topic'] };
    const ma = { ...base('maintenance_agent'), topics: ['ma-topic'] };
    const ga = { ...base('generating_agent'), topics: ['ga-topic'] };
    const hu = { ...base('human'), topics: ['hu-topic'] };

    expect(mergeCompactIndex([rb, ma, ga, hu]).topics).toEqual(['hu-topic']);
    expect(mergeCompactIndex([hu, rb]).topics).toEqual(['hu-topic']);
  });

  it('lower-precedence source fills a field the higher source left empty', () => {
    const rb = { ...base('rule_based'), topics: ['rb-topic'], flags: ['F'] };
    const hu = { ...base('human'), topics: ['hu-topic'] }; // flags empty
    const merged = mergeCompactIndex([rb, hu]);
    expect(merged.topics).toEqual(['hu-topic']);
    expect(merged.flags).toEqual(['F']);
  });

  it('empty inputs return rule_based defaults', () => {
    const merged = mergeCompactIndex([]);
    expect(merged.authored_by).toBe('rule_based');
    expect(merged.topics).toEqual([]);
  });

  it('authored_by reflects the highest-precedence source that contributed', () => {
    const rb = { ...base('rule_based'), topics: ['rb'] };
    const hu = { ...base('human'), flags: ['POLICY'] };
    expect(mergeCompactIndex([rb, hu]).authored_by).toBe('human');
  });
});

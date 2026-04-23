import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractCompactIndex } from '../extract';

describe('extractCompactIndex', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00Z'));
  });

  it('composes all fields into a CompactIndex', () => {
    const content = '## DECISION\n\nAcme Corp signed on 2026-04-22. Enterprise pricing approved.';
    const result = extractCompactIndex(content, { entities: [] });

    expect(result.proper_nouns).toContain('Acme Corp');
    expect(result.flags).toContain('DECISION');
    expect(result.date_hints).toContain('2026-04-22');
    expect(result.topics).toContain('enterprise');
    expect(result.key_sentence).toBeTruthy();
    expect(result.authored_by).toBe('rule_based');
    expect(result.computed_at).toBe('2026-04-22T12:00:00.000Z');
  });

  it('passes through explicitly provided entities', () => {
    const result = extractCompactIndex('prose', {
      entities: ['acme-corp', 'jane-smith'],
    });
    expect(result.entities).toEqual(['acme-corp', 'jane-smith']);
  });

  it('handles empty content', () => {
    const result = extractCompactIndex('', { entities: [] });
    expect(result.proper_nouns).toEqual([]);
    expect(result.key_sentence).toBe('');
    expect(result.authored_by).toBe('rule_based');
  });
});

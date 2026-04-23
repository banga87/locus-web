import { describe, it, expect, beforeEach, vi } from 'vitest';
import { populateCompactIndexForWrite } from '../ingest';

describe('populateCompactIndexForWrite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00Z'));
  });

  it('returns a CompactIndex with rule_based authoring', () => {
    const ci = populateCompactIndexForWrite({
      content: '## DECISION\n\nAcme Corp signed.',
      frontmatterEntities: [],
    });
    expect(ci.authored_by).toBe('rule_based');
    expect(ci.flags).toContain('DECISION');
    expect(ci.proper_nouns).toContain('Acme Corp');
  });

  it('passes frontmatter entities through unchanged', () => {
    const ci = populateCompactIndexForWrite({
      content: 'prose',
      frontmatterEntities: ['acme-corp'],
    });
    expect(ci.entities).toEqual(['acme-corp']);
  });
});

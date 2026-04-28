import { describe, expect, it } from 'vitest';
import { validateDocumentFrontmatter } from '../validate';

const vocabulary = {
  terms: ['brand', 'voice', 'pricing', 'customer'],
  synonyms: { users: 'customer' as const },
  version: 1,
};

const baseValid = {
  id: 'doc-001',
  title: 'Brand voice',
  type: 'canonical',
  source: 'human:angus',
  topics: ['brand', 'voice'],
  confidence: 'high',
  status: 'active',
  owner: 'angus',
  last_reviewed_at: '2026-04-01',
};

describe('validateDocumentFrontmatter', () => {
  it('accepts a fully valid canonical doc', () => {
    const result = validateDocumentFrontmatter(baseValid, vocabulary);
    expect(result.ok).toBe(true);
  });

  it('rejects when type-specific field is missing', () => {
    const { owner: _omit, ...rest } = baseValid;
    const result = validateDocumentFrontmatter(rest, vocabulary);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'owner')).toBe(true);
    }
  });

  it('rejects out-of-vocabulary topics with synonym hint when applicable', () => {
    const result = validateDocumentFrontmatter(
      { ...baseValid, topics: ['users'] },
      vocabulary,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const topicErr = result.errors.find((e) => e.field === 'topics');
      expect(topicErr).toBeTruthy();
      expect(topicErr?.message).toMatch(/customer/);
    }
  });

  it('rejects out-of-vocabulary topics with no hint when no synonym matches', () => {
    const result = validateDocumentFrontmatter(
      { ...baseValid, topics: ['novel-term'] },
      vocabulary,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'topics')).toBe(true);
    }
  });

  it('passes reserved types straight through (no per-type check)', () => {
    const reserved = {
      ...baseValid,
      type: 'skill',
    };
    // remove canonical-only owner to ensure reserved types skip per-type check.
    const { owner: _omit, last_reviewed_at: _omit2, ...rest } = reserved;
    const result = validateDocumentFrontmatter(rest, vocabulary);
    expect(result.ok).toBe(true);
  });

  it('aggregates errors across universal + type + topics', () => {
    const broken = {
      ...baseValid,
      confidence: 'super-high', // universal violation
      owner: '', // type-specific violation
      topics: ['unknown'], // vocabulary violation
    };
    const result = validateDocumentFrontmatter(broken, vocabulary);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = new Set(result.errors.map((e) => e.field));
      expect(fields.has('confidence')).toBe(true);
      expect(fields.has('owner')).toBe(true);
      expect(fields.has('topics')).toBe(true);
    }
  });
});

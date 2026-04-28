import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOCABULARY,
  DEFAULT_TERMS,
  DEFAULT_SYNONYMS,
  TERM_DESCRIPTIONS,
} from '../default-vocabulary';

describe('default vocabulary', () => {
  it('has exactly 33 terms', () => {
    expect(DEFAULT_TERMS.length).toBe(33);
  });

  it('terms are unique', () => {
    expect(new Set(DEFAULT_TERMS).size).toBe(DEFAULT_TERMS.length);
  });

  it('every term has a non-empty description', () => {
    for (const t of DEFAULT_TERMS) {
      expect(TERM_DESCRIPTIONS[t].length).toBeGreaterThan(0);
    }
  });

  it('includes the spec-required cluster anchors', () => {
    for (const required of [
      'brand',
      'voice',
      'design',
      'positioning',
      'market',
      'competitor',
      'icp',
      'customer',
      'feedback',
      'support',
      'product',
      'pricing',
      'feature',
      'roadmap',
      'campaign',
      'content',
      'event',
      'sales',
      'partnership',
      'team',
      'hiring',
      'finance',
      'legal',
      'vendor',
      'strategy',
      'engineering',
      'architecture',
      'bug',
      'incident',
      'infra',
      'security',
      'release',
      'api',
    ]) {
      expect(DEFAULT_TERMS).toContain(required);
    }
  });

  it('synonyms map every alias to a canonical term', () => {
    for (const [alias, canonical] of Object.entries(DEFAULT_SYNONYMS)) {
      expect(DEFAULT_TERMS).toContain(canonical);
      expect(alias).not.toBe(canonical); // a term mapping to itself is noise
    }
  });

  it('includes spec-listed synonyms (sample)', () => {
    expect(DEFAULT_SYNONYMS['users']).toBe('customer');
    expect(DEFAULT_SYNONYMS['clients']).toBe('customer');
    expect(DEFAULT_SYNONYMS['accounts']).toBe('customer');
    expect(DEFAULT_SYNONYMS['prospect']).toBe('sales');
    expect(DEFAULT_SYNONYMS['lead']).toBe('sales');
    expect(DEFAULT_SYNONYMS['competition']).toBe('competitor');
    expect(DEFAULT_SYNONYMS['target audience']).toBe('icp');
    expect(DEFAULT_SYNONYMS['ux']).toBe('design');
    expect(DEFAULT_SYNONYMS['vulnerability']).toBe('security');
  });

  it('exports a packaged Vocabulary record', () => {
    expect(DEFAULT_VOCABULARY.terms).toEqual(DEFAULT_TERMS);
    expect(DEFAULT_VOCABULARY.synonyms).toEqual(DEFAULT_SYNONYMS);
    expect(DEFAULT_VOCABULARY.version).toBe(1);
  });
});

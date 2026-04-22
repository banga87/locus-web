import { describe, it, expect } from 'vitest';
import { generateFolderOverview } from '../generate';

describe('generateFolderOverview', () => {
  it('rolls up child document titles + key sentences', () => {
    const out = generateFolderOverview({
      folderPath: 'pricing',
      children: [
        {
          path: 'pricing/enterprise',
          title: 'Enterprise Pricing',
          compact_index: {
            entities: [], topics: ['enterprise'], flags: ['POLICY'],
            proper_nouns: [], key_sentence: 'Enterprise tier starts at $50k.',
            date_hints: [], authored_by: 'rule_based',
            computed_at: '2026-04-22T00:00:00.000Z',
          },
        },
      ],
      childFolders: [],
    });

    expect(out).toContain('# Overview: pricing');
    expect(out).toContain('Enterprise Pricing');
    expect(out).toContain('Enterprise tier starts at $50k.');
  });

  it('lists child folders when present', () => {
    const out = generateFolderOverview({
      folderPath: 'root',
      children: [],
      childFolders: ['pricing', 'sales'],
    });
    expect(out).toContain('pricing');
    expect(out).toContain('sales');
  });

  it('returns a minimal header when folder is empty', () => {
    const out = generateFolderOverview({
      folderPath: 'empty',
      children: [],
      childFolders: [],
    });
    expect(out).toContain('# Overview: empty');
  });
});

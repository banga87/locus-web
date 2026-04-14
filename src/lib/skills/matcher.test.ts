// Unit tests for the skill matcher. Pure logic — no DB.
//
// Coverage:
//   - phrase hit returns a score that meets minScore
//   - prompts that fail to clear minScore return no matches
//   - candidateIds gates the pool
//   - score-desc / priority-desc tie-break ordering (the case the plan
//     left as `(expand test...)`)

import { describe, it, expect } from 'vitest';
import type { SkillManifest } from './manifest-compiler';
import { matchSkills } from './matcher';

const manifest: SkillManifest = {
  version: 1,
  builtAt: '2026-04-14T00:00:00Z',
  diagnostics: [],
  skills: [
    {
      id: 'c9f5e4a6-1',
      slug: 'draft-landing-page',
      title: 'Draft a Landing Page',
      description: '',
      priority: 5,
      triggers: {
        phrases: ['landing page'],
        allOf: [['draft', 'write']],
        anyOf: ['conversion'],
        minScore: 2,
      },
      bodyDocId: 'c9f5e4a6-1',
      bodyBytes: 200,
    },
  ],
};

describe('matchSkills', () => {
  it('matches skills whose phrases appear in the prompt', () => {
    const matches = matchSkills(
      manifest,
      'please write a landing page for our product',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe('c9f5e4a6-1');
    expect(matches[0].score).toBeGreaterThanOrEqual(2);
  });

  it('returns empty when prompt does not reach minScore', () => {
    const matches = matchSkills(manifest, 'unrelated question about cats');
    expect(matches).toHaveLength(0);
  });

  it('respects candidate pool filter (only matches skills in pool)', () => {
    const matches = matchSkills(manifest, 'write a landing page', {
      candidateIds: ['different-id'],
    });
    expect(matches).toHaveLength(0);
  });

  it('sorts by score desc, priority desc on ties', () => {
    // Two skills, both match the same prompt with the same score.
    // The higher-priority one must come first.
    const tieManifest: SkillManifest = {
      version: 1,
      builtAt: '2026-04-14T00:00:00Z',
      diagnostics: [],
      skills: [
        {
          id: 'low-priority',
          slug: 'low',
          title: 'Low Priority Match',
          description: '',
          priority: 2,
          triggers: {
            phrases: ['landing page'],
            allOf: [],
            anyOf: [],
            minScore: 1,
          },
          bodyDocId: 'low-priority',
          bodyBytes: 100,
        },
        {
          id: 'high-priority',
          slug: 'high',
          title: 'High Priority Match',
          description: '',
          priority: 8,
          triggers: {
            phrases: ['landing page'],
            allOf: [],
            anyOf: [],
            minScore: 1,
          },
          bodyDocId: 'high-priority',
          bodyBytes: 100,
        },
      ],
    };

    const matches = matchSkills(tieManifest, 'draft a landing page');
    expect(matches).toHaveLength(2);
    // Equal score (phrase ×2 = 2 for both) → priority breaks the tie.
    expect(matches[0].score).toBe(matches[1].score);
    expect(matches[0].id).toBe('high-priority');
    expect(matches[1].id).toBe('low-priority');
  });

  it('orders by score before priority (higher score wins over higher priority)', () => {
    // A low-priority skill that scores higher must come before a
    // high-priority skill that scores lower. Belt-and-braces against
    // a regression that flips the comparator order.
    const orderManifest: SkillManifest = {
      version: 1,
      builtAt: '2026-04-14T00:00:00Z',
      diagnostics: [],
      skills: [
        {
          id: 'high-priority-weak-match',
          slug: 'hpwm',
          title: 'High Priority, Weak Match',
          description: '',
          priority: 9,
          triggers: {
            phrases: [],
            allOf: [],
            anyOf: ['conversion'],
            minScore: 1,
          },
          bodyDocId: 'high-priority-weak-match',
          bodyBytes: 100,
        },
        {
          id: 'low-priority-strong-match',
          slug: 'lpsm',
          title: 'Low Priority, Strong Match',
          description: '',
          priority: 1,
          triggers: {
            // Two phrase hits → score 4 (2 phrases × weight 2).
            phrases: ['landing page', 'conversion'],
            allOf: [],
            anyOf: [],
            minScore: 1,
          },
          bodyDocId: 'low-priority-strong-match',
          bodyBytes: 100,
        },
      ],
    };

    const matches = matchSkills(
      orderManifest,
      'help me build a landing page focused on conversion',
    );
    expect(matches).toHaveLength(2);
    expect(matches[0].id).toBe('low-priority-strong-match');
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });
});

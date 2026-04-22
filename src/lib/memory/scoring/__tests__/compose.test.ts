import { describe, it, expect } from 'vitest';
import { composeBoostedScore } from '../compose';

describe('composeBoostedScore', () => {
  it('multiplies tsRank by all applicable boosts', () => {
    const score = composeBoostedScore({
      tsRank: 0.5,
      query: '"decision" made by Jane',
      content: 'The decision was made by Jane.',
      docUpdatedAt: new Date('2026-04-22'),
    });
    // phraseBoost: 1.6, properNounBoost: 1.4, temporalProximity: 1.0 (no query date)
    expect(score).toBeCloseTo(0.5 * 1.6 * 1.4);
  });

  it('returns tsRank unchanged when no boosts apply', () => {
    const score = composeBoostedScore({
      tsRank: 0.3,
      query: 'plain query',
      content: 'irrelevant content',
      docUpdatedAt: new Date(),
    });
    expect(score).toBe(0.3);
  });
});

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

describe('composeBoostedScore — Phase 2 cosineSim term', () => {
  const baseInput = {
    tsRank: 0.5,
    query: 'pricing',
    content: 'Enterprise pricing tier starts at $50k.',
    docUpdatedAt: new Date(),
  };

  it('cosineSim=null falls through cleanly (Phase 1 behavior)', () => {
    const score = composeBoostedScore({ ...baseInput, cosineSim: null });
    expect(score).toBeGreaterThan(0);
    expect(score).not.toBeNaN();
  });

  it('cosineSim raises the score above the cosine-null baseline', () => {
    const lo = composeBoostedScore({ ...baseInput, cosineSim: null });
    const hi = composeBoostedScore({ ...baseInput, cosineSim: 0.9 });
    expect(hi).toBeGreaterThan(lo);
  });

  it('weights override changes the lexical/semantic balance', () => {
    const semHeavy = composeBoostedScore({
      ...baseInput,
      cosineSim: 0.9,
      weights: { ts: 0.1, vec: 0.9 },
    });
    const lexHeavy = composeBoostedScore({
      ...baseInput,
      cosineSim: 0.9,
      weights: { ts: 0.9, vec: 0.1 },
    });
    expect(semHeavy).toBeGreaterThan(lexHeavy);
  });

  it('weights override with vec=0 reproduces Phase 1 lexical-only behavior', () => {
    const phase2WithVecOff = composeBoostedScore({
      ...baseInput,
      cosineSim: 0.9,
      weights: { ts: 1, vec: 0 },
    });
    const phase1NullCosine = composeBoostedScore({
      ...baseInput,
      cosineSim: null,
      weights: { ts: 1, vec: 0 },
    });
    expect(phase2WithVecOff).toBeCloseTo(phase1NullCosine, 5);
  });
});

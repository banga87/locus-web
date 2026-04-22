import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { retrieve } from '../core';
import {
  seedTwoDocumentsInOneBrain,
  seedBrainInCompany,
  teardownSeed,
  type TwoDocsCtx,
  type SeededBrain,
} from './_fixtures';

describe('retrieve — scan mode', () => {
  let ctx: TwoDocsCtx;

  beforeAll(async () => {
    ctx = await seedTwoDocumentsInOneBrain({
      docA: { title: 'A', content: 'Acme Corp enterprise pricing terms.' },
      docB: { title: 'B', content: 'Unrelated narrative paragraph.' },
    });
  });

  afterAll(async () => {
    await teardownSeed(ctx);
  });

  it('returns hits with provenance and compact_index, no excerpt', async () => {
    const results = await retrieve({
      brainId: ctx.brainId,
      companyId: ctx.companyId,
      query: 'Acme',
      mode: 'scan',
      tierCeiling: 'extracted',
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    const hit = results[0];
    expect(hit.provenance.brainId).toBe(ctx.brainId);
    expect(hit.provenance.confidenceTier).toBe('extracted');
    expect(hit.snippet.mode).toBe('compact');
    expect(hit.compactIndex).toBeDefined();
    expect(hit.excerpt).toBeUndefined();
  });
});

describe('retrieve — expand mode', () => {
  let ctx: TwoDocsCtx;

  beforeAll(async () => {
    ctx = await seedTwoDocumentsInOneBrain({
      docA: { title: 'A', content: 'Acme Corp enterprise pricing terms.' },
      docB: { title: 'B', content: 'Unrelated narrative paragraph.' },
    });
  });

  afterAll(async () => {
    await teardownSeed(ctx);
  });

  it('returns ts_headline and an excerpt with surrounding context', async () => {
    const results = await retrieve({
      brainId: ctx.brainId,
      companyId: ctx.companyId,
      query: 'Acme',
      mode: 'expand',
      tierCeiling: 'extracted',
      limit: 10,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].snippet.mode).toBe('headline');
    expect(results[0].excerpt).toBeDefined();
  });
});

describe('retrieve — hybrid mode', () => {
  let ctx: SeededBrain;

  beforeAll(async () => {
    // Seed >= 5 docs that all match "Acme" so we can verify the
    // top-3-expand / rest-scan split deterministically.
    ctx = await seedBrainInCompany({
      docs: [
        { title: 'A1', content: 'Acme Corp first paragraph about pricing.' },
        { title: 'A2', content: 'Acme Corp second paragraph about renewal.' },
        { title: 'A3', content: 'Acme Corp third paragraph about support.' },
        { title: 'A4', content: 'Acme Corp fourth paragraph about onboarding.' },
        { title: 'A5', content: 'Acme Corp fifth paragraph about expansion.' },
      ],
    });
  });

  afterAll(async () => {
    await teardownSeed(ctx);
  });

  it('top-3 results use expand snippet, rest use compact', async () => {
    const results = await retrieve({
      brainId: ctx.brainId,
      companyId: ctx.companyId,
      query: 'Acme',
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: 5,
    });
    expect(results.length).toBe(5);
    expect(
      results.slice(0, 3).every((r) => r.snippet.mode === 'headline'),
    ).toBe(true);
    expect(
      results.slice(3).every((r) => r.snippet.mode === 'compact'),
    ).toBe(true);
  });
});

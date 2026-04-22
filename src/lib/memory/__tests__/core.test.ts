import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { retrieve } from '../core';
import {
  seedTwoDocumentsInOneBrain,
  teardownSeed,
  type TwoDocsCtx,
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

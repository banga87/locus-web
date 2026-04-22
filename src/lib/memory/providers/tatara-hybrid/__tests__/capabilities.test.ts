import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tataraHybridProvider } from '../index';
import {
  seedBrainInCompany,
  teardownSeed,
  type SeededBrain,
} from '@/lib/memory/__tests__/_fixtures';

describe('tataraHybridProvider.describe()', () => {
  it('reports the Phase 1 capability set', () => {
    const c = tataraHybridProvider.describe();
    expect(c.name).toBe('tatara-hybrid');
    expect(c.supports.factLookup).toBe(false);
    expect(c.supports.graphTraverse).toBe(false);
    expect(c.supports.timeline).toBe(false);
    expect(c.supports.embeddings).toBe(false);
  });
});

describe('tataraHybridProvider.brainOverview() tenancy', () => {
  let a: SeededBrain;
  let b: SeededBrain;

  beforeAll(async () => {
    a = await seedBrainInCompany({
      docs: [{ title: 'A-doc', content: 'Acme signed contract terms.' }],
    });
    b = await seedBrainInCompany({
      docs: [{ title: 'B-doc', content: 'Unrelated narrative paragraph.' }],
    });
  });

  afterAll(async () => {
    await teardownSeed(a);
    await teardownSeed(b);
  });

  it('returns empty string when companyId does not match the brain', async () => {
    // Call with company A's id but brain B's id. The brain_id →
    // company_id relationship makes this tuple invalid; the provider
    // must return empty rather than leak the overview from brain B.
    const out = await tataraHybridProvider.brainOverview(
      a.companyId,
      b.brainId,
      'pricing',
    );
    expect(out).toBe('');
  });

  it('returns the overview when the (companyId, brainId) tuple is valid', async () => {
    const out = await tataraHybridProvider.brainOverview(
      b.companyId,
      b.brainId,
      'pricing',
    );
    expect(out).toContain('# Overview: pricing');
    expect(out).toContain('B-doc');
  });
});

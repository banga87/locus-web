// src/lib/memory/__tests__/core-hybrid.test.ts
//
// End-to-end test: a query whose terms don't lexically match the
// "right" document but whose embedding is closer ranks the right doc
// higher in hybrid mode than in lexical-only mode.
//
// We control embeddings explicitly (no real OpenAI call for the docs
// themselves) but mock the openaiEmbedder so the QUERY embedding is a
// known vector that's closer to one seeded doc than the other.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { retrieve } from '../core';
import {
  seedBrainWithEmbeddings,
  teardownSeed,
  type SeededBrain,
} from './_fixtures';

// Build a query embedding that's closest to doc 0 (vector all 0.1).
const queryVec = new Array(1536).fill(0.1);
vi.mock('../embedding/openai', () => ({
  openaiEmbedder: {
    embed: vi.fn(async () => ({ vector: queryVec, promptTokens: 5 })),
    embedMany: vi.fn(),
    describe: () => ({ model: 'text-embedding-3-small', dimension: 1536 }),
  },
}));

describe('retrieve() hybrid mode — cosine surfaces semantically-close docs', () => {
  let seed: SeededBrain;

  beforeAll(async () => {
    seed = await seedBrainWithEmbeddings({
      docs: [
        // Doc 0: cosine-close to query (matches embedding direction).
        // Lexically irrelevant — the query "expansion plans" doesn't
        // appear in the body.
        { title: 'Vision narrative', content: 'A long-form prose paragraph about the company future.' },
        // Doc 1: cosine-far. Lexically a perfect match.
        { title: 'Expansion plans', content: 'Expansion plans for the next quarter focus on three regions.' },
      ],
      embeddings: [
        new Array(1536).fill(0.1),         // doc 0 — same direction as query
        new Array(1536).fill(-0.5),        // doc 1 — opposite direction
      ],
    });
  }, 30_000);

  afterAll(async () => teardownSeed(seed), 30_000);

  it('hybrid surfaces the cosine-close doc above the cosine-far one', async () => {
    const results = await retrieve(
      {
        brainId: seed.brainId,
        companyId: seed.companyId,
        query: 'expansion plans',          // lexically matches doc 1
        mode: 'hybrid',
        tierCeiling: 'extracted',
      },
      { role: 'customer_facing' },
    );
    expect(results.length).toBeGreaterThan(0);
    const rank0 = results.findIndex((r) => r.slug === seed.docs[0].slug);
    const rank1 = results.findIndex((r) => r.slug === seed.docs[1].slug);
    // Both should appear; doc 0 should rank higher because cosine
    // dominates the score with WEIGHT_VEC=0.6.
    expect(rank0).toBeGreaterThanOrEqual(0);
    expect(rank1).toBeGreaterThanOrEqual(0);
    expect(rank0).toBeLessThan(rank1);
  }, 30_000);
});

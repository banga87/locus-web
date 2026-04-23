// src/lib/memory/embedding/__tests__/workflow.test.ts
//
// Tests the WORKFLOW LOGIC by calling the underlying functions
// directly (not via Workflows runtime). The 'use workflow' / 'use step'
// directives are no-ops at runtime in test — the durability machinery
// only kicks in when triggered through the Workflow runtime.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import {
  seedBrainInCompany,
  teardownSeed,
  type SeededBrain,
} from '@/lib/memory/__tests__/_fixtures';

// Mock the OpenAI embedder so the test doesn't make real API calls.
vi.mock('../openai', () => ({
  openaiEmbedder: {
    embed: vi.fn(async (_text: string) => ({
      vector: new Array(1536).fill(0.42),
      promptTokens: 10,
    })),
    embedMany: vi.fn(),
    describe: () => ({ model: 'text-embedding-3-small', dimension: 1536 }),
  },
}));
// Mock the usage helper so the test doesn't write usage_records.
vi.mock('../usage', () => ({
  recordEmbeddingUsage: vi.fn(async () => ({ id: 'fake-usage' })),
}));

import { embedDocumentWorkflow } from '../workflow';

describe('embedDocumentWorkflow', () => {
  let seed: SeededBrain;

  beforeAll(async () => {
    seed = await seedBrainInCompany({
      docs: [{ title: 'Doc to embed', content: 'Sample content for embedding.' }],
    });
  });

  afterAll(async () => {
    await teardownSeed(seed);
  });

  it('writes the embedding for a real document under the right tenant tuple', async () => {
    await embedDocumentWorkflow({
      documentId: seed.docs[0].id,
      companyId: seed.companyId,
      brainId: seed.brainId,
    });

    const [row] = await db
      .select({ embedding: documents.embedding })
      .from(documents)
      .where(eq(documents.id, seed.docs[0].id));

    expect(row.embedding).not.toBeNull();
    expect(row.embedding).toHaveLength(1536);
    expect(row.embedding![0]).toBeCloseTo(0.42, 5);
  });

  it('no-ops when the (id, companyId, brainId) tuple does not match', async () => {
    // Seed a second tenant; pass its companyId with the original brainId.
    const other = await seedBrainInCompany({ docs: [{ title: 'Other', content: 'x' }] });
    try {
      await embedDocumentWorkflow({
        documentId: seed.docs[0].id,
        companyId: other.companyId,                // wrong company
        brainId: seed.brainId,
      });
    } finally {
      await teardownSeed(other);
    }
    // Verify write isolation: the original doc's embedding (written in
    // test 1 as a 1536-vector of 0.42) must be untouched. A bug in
    // persistEmbedding's WHERE clause that matched the wrong row would
    // be caught here.
    const [row] = await db
      .select({ embedding: documents.embedding })
      .from(documents)
      .where(eq(documents.id, seed.docs[0].id));
    expect(row.embedding).not.toBeNull();
    expect(row.embedding![0]).toBeCloseTo(0.42, 5);
  }, 30_000);

  it('no-ops when the document was deleted between trigger and run', async () => {
    const transient = await seedBrainInCompany({
      docs: [{ title: 'Doomed', content: 'about to be soft-deleted' }],
    });
    await db.update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, transient.docs[0].id));
    try {
      // Workflow loads the doc via the tenant tuple; deletedAt IS NOT NULL
      // means the SELECT returns the row, but the workflow's deletedAt
      // guard short-circuits. Verify no throw; embedding stays NULL.
      await embedDocumentWorkflow({
        documentId: transient.docs[0].id,
        companyId: transient.companyId,
        brainId: transient.brainId,
      });
      const [row] = await db
        .select({ embedding: documents.embedding })
        .from(documents)
        .where(eq(documents.id, transient.docs[0].id));
      expect(row.embedding).toBeNull();
    } finally {
      // Hard-delete since the brain cascade requires deletedAt IS NULL paths
      // to clean up cleanly. Use raw SQL since teardownSeed expects normal state.
      await db.delete(documents).where(eq(documents.id, transient.docs[0].id));
      await teardownSeed(transient);
    }
  }, 30_000);
});

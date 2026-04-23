// tests/benchmarks/__tests__/smoke-concurrent-workflow.test.ts
//
// Triggers 5 embeddings simultaneously and verifies all 5 land within
// a reasonable time bound. Catches regressions in workflow registration
// + the trigger→workflow→DB roundtrip without the cost of a full
// 500-workflow chaos run (those stay manual per spec §8.4).
//
// IMPORTANT: this test depends on the Vercel Workflow runtime being
// available to actually execute the embedDocumentWorkflow that
// triggerEmbeddingFor enqueues. In a plain vitest process the runtime
// is not running, so the trigger silently enqueues but no embedding
// ever lands. The test therefore gates on `RUN_WORKFLOW_SMOKE=1` so it
// runs only in environments where the runtime is up (deployed preview,
// nightly CI with workflow runner). When the env var is unset (default
// `vitest run`), it skips with `it.skip`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import {
  seedBrainInCompany,
  teardownSeed,
  type SeededBrain,
} from '@/lib/memory/__tests__/_fixtures';
import { triggerEmbeddingFor } from '@/lib/memory/embedding/trigger';

const RUNTIME_AVAILABLE = process.env.RUN_WORKFLOW_SMOKE === '1';
const test = RUNTIME_AVAILABLE ? it : it.skip;

describe('embedding workflow — 5-concurrent smoke', () => {
  let seed: SeededBrain;

  beforeAll(async () => {
    if (!RUNTIME_AVAILABLE) return;             // skip seed when test is skipped
    seed = await seedBrainInCompany({
      docs: Array.from({ length: 5 }, (_, i) => ({
        title: `Concurrent ${i}`,
        content: `Test document number ${i} for concurrent workflow run.`,
      })),
    });
  }, 30_000);

  afterAll(async () => {
    if (!RUNTIME_AVAILABLE) return;
    await teardownSeed(seed);
  });

  test('all 5 embeddings land within 60s', async () => {
    await Promise.all(
      seed.docs.map((d) =>
        triggerEmbeddingFor({
          documentId: d.id,
          companyId: seed.companyId,
          brainId: seed.brainId,
        }),
      ),
    );

    const start = Date.now();
    while (Date.now() - start < 60_000) {
      const populated = await Promise.all(
        seed.docs.map(async (d) => {
          const [r] = await db
            .select({ embedding: documents.embedding })
            .from(documents)
            .where(eq(documents.id, d.id));
          return r.embedding !== null;
        }),
      );
      if (populated.every(Boolean)) {
        expect(populated.every(Boolean)).toBe(true);
        return;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error('5-concurrent embeddings did not all land within 60s');
  }, 70_000);
});

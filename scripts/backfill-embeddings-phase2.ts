// scripts/backfill-embeddings-phase2.ts
//
// One-shot backfill of embeddings for documents written before Phase 2
// landed. Idempotent: each invocation processes every doc still missing
// an embedding.
//
// Synchronous vs fire-and-forget:
//   triggerEmbeddingFor enqueues to the Vercel Workflow runtime (start()
//   from 'workflow/api'). That runtime is not available in a plain tsx
//   process, so the enqueue call would fail or silently no-op. Instead,
//   we call embedDocumentWorkflow directly — the 'use workflow' / 'use
//   step' directives are no-ops outside the runtime, so each call runs
//   synchronously inline. Production write paths (route handlers) still
//   use triggerEmbeddingFor for true fire-and-forget behaviour.
//   Mirrors the approach used in tests/benchmarks/seed.ts (Task 22).
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/backfill-embeddings-phase2.ts
//
// Or, if .env.local is present in the project root:
//   npx tsx -r dotenv/config scripts/backfill-embeddings-phase2.ts

import 'dotenv/config';
import { isNull } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { embedDocumentWorkflow } from '@/lib/memory/embedding/workflow';

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: documents.id,
      companyId: documents.companyId,
      brainId: documents.brainId,
    })
    .from(documents)
    .where(isNull(documents.embedding));

  console.log(`[backfill] embedding ${rows.length} docs synchronously`);
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await embedDocumentWorkflow({
        documentId: row.id,
        companyId: row.companyId,
        brainId: row.brainId,
      });
      console.log(`[backfill] embedded ${row.id}`);
      succeeded++;
    } catch (err) {
      console.error(`[backfill] failed to embed ${row.id}`, err);
      failed++;
    }
  }
  console.log(`[backfill] done — ${succeeded} embedded, ${failed} failed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });

// scripts/backfill-embeddings-phase2.ts
//
// One-shot backfill of embeddings for documents written before Phase 2
// landed. Mirrors Phase 1's scripts/backfill-compact-index-phase1.ts
// shape but triggers the embedDocumentWorkflow per row rather than
// computing inline. Idempotent: each invocation enqueues a workflow
// for every doc still missing an embedding.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/backfill-embeddings-phase2.ts
//
// Or, if .env is present in the project root:
//   npx tsx -r dotenv/config scripts/backfill-embeddings-phase2.ts

import 'dotenv/config';
import { isNull } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { triggerEmbeddingFor } from '@/lib/memory/embedding/trigger';

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: documents.id,
      companyId: documents.companyId,
      brainId: documents.brainId,
    })
    .from(documents)
    .where(isNull(documents.embedding));

  console.log(`[backfill] enqueueing embedding workflows for ${rows.length} docs`);
  for (const row of rows) {
    try {
      await triggerEmbeddingFor({
        documentId: row.id,
        companyId: row.companyId,
        brainId: row.brainId,
      });
      console.log(`[backfill] triggered ${row.id}`);
    } catch (err) {
      console.error(`[backfill] failed to trigger ${row.id}`, err);
    }
  }
  console.log(`[backfill] done — enqueued ${rows.length} runs`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });

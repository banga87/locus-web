// tests/benchmarks/seed.ts
//
// CLI-friendly variant of seedBrainInCompany that doesn't depend on
// vitest. Used by tests/benchmarks/runner.ts to seed a fresh
// (company, brain, folder) and a corpus of documents from the
// benchmark fixture. Returns the IDs the runner needs.
//
// NOTE: this writes to the same DB as the dev server. Use a dedicated
// benchmark DB or drop the seeded company afterwards via teardownBenchmarkSeed.

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { brains } from '@/db/schema/brains';
import { companies } from '@/db/schema/companies';
import { documents } from '@/db/schema/documents';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { usageRecords } from '@/db/schema/usage-records';
import { extractCompactIndex } from '@/lib/memory/compact-index/extract';
// Benchmarks call the workflow function directly rather than going through
// triggerEmbeddingFor (which enqueues to the Vercel Workflow runtime). In a
// plain tsx process the Workflow runtime is not running, so the enqueue call
// would return immediately but the workflow would never execute, causing
// waitForEmbeddings to time out. The 'use workflow' / 'use step' directives
// are no-ops in a normal Node process, so the function runs synchronously
// and writes the embedding inline — correct for benchmark purposes.
// Production code (route handlers) still uses the fire-and-forget path.
import { embedDocumentWorkflow } from '@/lib/memory/embedding/workflow';

export interface BenchmarkDoc {
  slug: string;
  title: string;
  content: string;
}

export interface SeededBenchmark {
  companyId: string;
  brainId: string;
  ownerUserId: string;
  docIds: Record<string, string>;          // slug → uuid
}

export async function seedBenchmarkBrain(
  corpus: BenchmarkDoc[],
): Promise<SeededBenchmark> {
  const suffix = `bench-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Bench Co ${suffix}`, slug: `bench-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company.id, name: 'Bench', slug: 'bench' })
    .returning({ id: brains.id });

  const [folder] = await db
    .insert(folders)
    .values({ companyId: company.id, brainId: brain.id, slug: 'corpus', name: 'Corpus' })
    .returning({ id: folders.id });

  const ownerId = randomUUID();
  await db.insert(users).values({
    id: ownerId,
    companyId: company.id,
    fullName: 'Bench Owner',
    email: `bench-${suffix}@example.test`,
    status: 'active',
  });

  const docIds: Record<string, string> = {};
  for (const d of corpus) {
    const ci = extractCompactIndex(d.content, { entities: [] });
    const [row] = await db
      .insert(documents)
      .values({
        companyId: company.id,
        brainId: brain.id,
        folderId: folder.id,
        title: d.title,
        slug: d.slug,
        path: `corpus/${d.slug}`,
        content: d.content,
        status: 'active',
        ownerId,
        compactIndex: ci,
      })
      .returning({ id: documents.id });
    docIds[d.slug] = row.id;

    // Call the workflow function directly so embeddings are persisted before
    // this function returns. The Workflow runtime is not running in a plain
    // tsx process, so the fire-and-forget path would never execute.
    await embedDocumentWorkflow({
      documentId: row.id,
      companyId: company.id,
      brainId: brain.id,
    });
  }

  return { companyId: company.id, brainId: brain.id, ownerUserId: ownerId, docIds };
}

export async function teardownBenchmarkSeed(s: SeededBenchmark): Promise<void> {
  await db.delete(users).where(eq(users.id, s.ownerUserId));
  // Delete usage_records before companies because the FK is onDelete: restrict.
  await db.delete(usageRecords).where(eq(usageRecords.companyId, s.companyId));
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, s.brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, s.companyId));
}

export async function waitForEmbeddings(
  brainId: string,
  expectedCount: number,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM documents
      WHERE brain_id = ${brainId} AND embedding IS NOT NULL
    `);
    const n = Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
    if (n >= expectedCount) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`waitForEmbeddings timed out: ${expectedCount} expected for brain ${brainId}`);
}

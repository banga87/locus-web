// One-shot backfill of compact_index for documents written before the
// write-pipeline landed (Phase 1 Task 11). Mirrors the logic of the
// admin endpoint at src/app/api/admin/backfill-compact-index/route.ts
// but runs as a CLI so it can be invoked without standing up the dev
// server or possessing an owner session.
//
// Idempotent: each invocation updates only rows where compact_index IS
// NULL. Safe to run repeatedly.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/backfill-compact-index-phase1.ts
//
// Or, if .env is already present in the project root:
//   npx tsx -r dotenv/config scripts/backfill-compact-index-phase1.ts

import 'dotenv/config';
import { eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { extractCompactIndex } from '@/lib/memory/compact-index/extract';

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await db
      .select({
        id: documents.id,
        content: documents.content,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(isNull(documents.compactIndex))
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    for (const row of rows) {
      const md = (row.metadata as Record<string, unknown> | null) ?? {};
      const entities = Array.isArray(md.entities)
        ? (md.entities as unknown[]).filter(
            (e): e is string => typeof e === 'string',
          )
        : [];
      const ci = extractCompactIndex(row.content ?? '', { entities });
      await db
        .update(documents)
        .set({ compactIndex: ci })
        .where(eq(documents.id, row.id));
    }

    total += rows.length;
    console.log(`[backfill] batch done — total updated: ${total}`);
  }

  console.log(`[backfill] finished — ${total} documents populated`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exit(1);
  });

/**
 * One-off backfill: populate `documents.type` from frontmatter for rows
 * that pre-date the Phase 1.5 column.
 *
 * Safe to re-run. Only rows where `type IS NULL` are visited; rows
 * already populated by the write path are left alone.
 *
 * Usage:
 *   npx tsx scripts/backfill-document-type.ts
 *
 * Requires DATABASE_URL in the environment (dotenv picks it up from
 * .env automatically).
 */

import 'dotenv/config';
import { isNull, sql } from 'drizzle-orm';

import { db, pgClient } from '../src/db';
import { documents } from '../src/db/schema';
import { extractDocumentTypeFromContent } from '../src/lib/brain/save';

async function main(): Promise<void> {
  // Select id + content for rows missing a type. The backfill is
  // idempotent because the update predicate pins `type IS NULL`, so
  // a second run is a no-op.
  const rows = await db
    .select({ id: documents.id, content: documents.content })
    .from(documents)
    .where(isNull(documents.type));

  console.log(`[backfill] ${rows.length} rows without documents.type`);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const extracted = extractDocumentTypeFromContent(row.content);
    if (extracted === null) {
      // Content has no frontmatter or no `type:` — leave NULL.
      skipped++;
      continue;
    }

    // Guard clause on update: only write when the row is still NULL.
    // Protects against races with concurrent writes from the app.
    await db
      .update(documents)
      .set({ type: extracted })
      .where(sql`${documents.id} = ${row.id} AND ${documents.type} IS NULL`);

    updated++;
  }

  console.log(
    `[backfill] updated ${updated} rows, skipped ${skipped} (no frontmatter type)`,
  );
}

main()
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Close the postgres client so the process exits cleanly.
    await pgClient.end();
  });

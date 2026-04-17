/**
 * One-off migration. Restores documents.type + metadata + content for
 * workflow docs whose frontmatter got flattened by the Tiptap round-trip
 * bug (fixed in the Frontmatter Editor change). Idempotent: docs whose
 * type is already set are skipped.
 *
 * Usage:
 *   npx tsx scripts/migrate-repair-frontmatter.ts --dry-run
 *   npx tsx scripts/migrate-repair-frontmatter.ts --apply
 *
 * Requires DATABASE_URL in the environment (dotenv picks it up).
 */

import 'dotenv/config';
import { asc, eq, isNull, sql } from 'drizzle-orm';

import { db, pgClient } from '../src/db';
import { documents, documentVersions } from '../src/db/schema';
import { splitFrontmatter, joinFrontmatter } from '../src/lib/frontmatter/markdown';
import { workflowSchema } from '../src/lib/frontmatter/schemas/workflow';
import {
  extractWorkflowFromVersion1,
  isCorruptedWorkflowDoc,
  stripCorruptionPreamble,
} from './lib/repair-frontmatter';

async function main(): Promise<void> {
  const dryRun = !process.argv.includes('--apply');
  console.log(`[migrate-repair-frontmatter] ${dryRun ? 'DRY-RUN' : 'APPLY'}`);

  const candidates = await db
    .select({
      id: documents.id,
      content: documents.content,
      type: documents.type,
      metadata: documents.metadata,
    })
    .from(documents)
    .where(isNull(documents.type));

  let repaired = 0;
  let skippedNotCorrupt = 0;
  let skippedUnknownShape = 0;
  let skippedNoV1 = 0;

  for (const row of candidates) {
    if (
      !isCorruptedWorkflowDoc({
        type: row.type,
        metadata: row.metadata as Record<string, unknown> | null,
      })
    ) {
      skippedNotCorrupt += 1;
      continue;
    }

    const [v1] = await db
      .select({ content: documentVersions.content })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, row.id))
      .orderBy(asc(documentVersions.versionNumber))
      .limit(1);

    if (!v1) {
      skippedNoV1 += 1;
      continue;
    }

    const extracted = extractWorkflowFromVersion1(v1.content);
    if (!extracted) {
      skippedNoV1 += 1;
      continue;
    }

    // Derive the user's authoritative body. Preferred path: strip the known
    // corruption preamble from the current content. Fallback: if a clean
    // frontmatter block somehow survived, use its body.
    let currentBody = stripCorruptionPreamble(row.content);
    if (currentBody == null) {
      const split = splitFrontmatter(row.content);
      if (split.frontmatterText != null) currentBody = split.body;
    }
    if (currentBody == null) {
      console.warn(`[skip:unknown-shape] ${row.id}`);
      skippedUnknownShape += 1;
      continue;
    }

    const newContent = joinFrontmatter(extracted.metadata, currentBody, workflowSchema);

    console.log(`[restore] ${row.id}`);
    if (!dryRun) {
      await db
        .update(documents)
        .set({
          content: newContent,
          type: 'workflow',
          metadata: {
            ...((row.metadata as Record<string, unknown>) ?? {}),
            ...extracted.metadata,
          },
          updatedAt: sql`now()`,
        })
        .where(eq(documents.id, row.id));
    }
    repaired += 1;
  }

  console.log(
    `[migrate-repair-frontmatter] done: repaired=${repaired} skippedNotCorrupt=${skippedNotCorrupt} skippedNoV1=${skippedNoV1} skippedUnknownShape=${skippedUnknownShape}`,
  );
}

main()
  .catch((err) => {
    console.error('[migrate-repair-frontmatter] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgClient.end();
  });

/**
 * One-shot migration: rewrites existing `type='workflow'` documents into
 * `type='skill'` documents with their four trigger fields (output,
 * output_category, requires_mcps, schedule) nested under `metadata.trigger`
 * AND under a `trigger:` block in the YAML frontmatter of the content body.
 *
 * The document_versions_immutable Postgres trigger creates a new version
 * row on every UPDATE — this migration will therefore double every
 * workflow doc's version count. That's accepted behaviour for a one-off
 * migration (see Task 2 of the skill-workflow unification plan).
 *
 * Usage:
 *   pnpm tsx scripts/migrate-workflow-to-triggered-skill.ts
 *   pnpm tsx scripts/migrate-workflow-to-triggered-skill.ts --dry-run
 *
 * Requires DATABASE_URL in the environment (dotenv picks it up from .env).
 *
 * Idempotent: rows that are already `type='skill'` AND have
 * `metadata.trigger` are skipped on subsequent runs.
 */

import 'dotenv/config';
import { and, eq, isNull, sql } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db, pgClient } from '../src/db';
import { documents } from '../src/db/schema';

const TRIGGER_KEYS = [
  'output',
  'output_category',
  'requires_mcps',
  'schedule',
] as const;

export interface MigrationResult {
  /** Rows whose content + metadata were rewritten. */
  touched: number;
  /** Rows skipped because they were already migrated. */
  skippedAlreadyMigrated: number;
  /** Rows skipped because their content had no parseable frontmatter. */
  warnedMalformed: number;
  /** Already-migrated rows with a stale `metadata.type='workflow'` key scrubbed. */
  scrubbedStaleType: number;
}

interface Row {
  id: string;
  content: string;
  metadata: unknown;
  type: string | null;
}

/**
 * Pull the frontmatter block + body out of a document's content.
 * CRLF-safe. Returns null when there is no `---\n...---` preamble.
 */
function splitFrontmatter(content: string): {
  raw: string;
  body: string;
  match: string;
} | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  if (!match) return null;
  return {
    raw: match[1]!,
    body: content.slice(match[0].length),
    match: match[0],
  };
}

/**
 * Rewrite the frontmatter block of a workflow doc's content into the new
 * triggered-skill shape. Returns `null` if the input has no frontmatter
 * block, or the block can't be parsed. Preserves the body byte-for-byte.
 */
export function rewriteWorkflowContent(content: string): string | null {
  const split = splitFrontmatter(content);
  if (!split) return null;

  let parsed: unknown;
  try {
    parsed = yaml.load(split.raw);
  } catch {
    return null;
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const fm = { ...(parsed as Record<string, unknown>) };

  // Flip type. Tolerate docs that omitted it entirely.
  fm.type = 'skill';

  // Pluck the four trigger fields out of the flat frontmatter and nest
  // them under `trigger:`. Normalise absent → null / [] so the resulting
  // block is well-formed.
  const trigger: Record<string, unknown> = {
    output: fm.output ?? 'document',
    output_category: fm.output_category ?? null,
    requires_mcps: Array.isArray(fm.requires_mcps) ? fm.requires_mcps : [],
    schedule: fm.schedule ?? null,
  };

  for (const key of TRIGGER_KEYS) {
    delete fm[key];
  }

  fm.trigger = trigger;

  // Emit YAML. Use block style for readability; explicit null keeps
  // behaviour consistent with how the editor round-trips today.
  const newYaml = yaml
    .dump(fm, {
      lineWidth: -1, // no line wrapping
      noRefs: true,
      sortKeys: false,
    })
    .replace(/\n$/, ''); // dump() appends a trailing newline; we fence it.

  return `---\n${newYaml}\n---\n${split.body.startsWith('\n') ? '' : '\n'}${split.body}`;
}

/**
 * Rewrite the `metadata` jsonb: remove the four flat trigger keys, replace
 * with a nested `trigger` sub-object. Unrelated keys (outbound_links, etc.)
 * pass through untouched.
 */
export function rewriteMetadata(
  existing: Record<string, unknown> | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(existing ?? {}) };

  const trigger = {
    output: base.output ?? 'document',
    output_category: base.output_category ?? null,
    requires_mcps: Array.isArray(base.requires_mcps) ? base.requires_mcps : [],
    schedule: base.schedule ?? null,
  };

  for (const key of TRIGGER_KEYS) {
    delete base[key];
  }

  // Drop stale denormalised `type` if the old workflow save path mirrored it.
  // The doc's `documents.type` column is authoritative.
  if (base.type === 'workflow' || base.type === 'skill') {
    delete base.type;
  }

  base.trigger = trigger;
  return base;
}

/**
 * Main migration entry point. Exported for programmatic use (tests) as
 * well as the CLI path below.
 */
export async function migrate(
  opts: { dryRun?: boolean } = {},
): Promise<MigrationResult> {
  const dryRun = opts.dryRun ?? false;

  return db.transaction(async (tx) => {
    // Candidates: live rows of type 'workflow'. We also pick up the
    // already-`type='skill' && metadata.trigger` case to count it
    // explicitly as an idempotency skip, but since the write path only
    // flips type=workflow rows and `metadata.trigger` only exists after
    // a successful run, the two predicates are mutually exclusive for
    // live data.
    //
    // The WHERE on `type='workflow'` AND `deleted_at IS NULL` matches
    // the plan's guarantee: we don't touch soft-deleted rows.
    const candidates = (await tx
      .select({
        id: documents.id,
        content: documents.content,
        metadata: documents.metadata,
        type: documents.type,
      })
      .from(documents)
      .where(
        and(eq(documents.type, 'workflow'), isNull(documents.deletedAt)),
      )) as Row[];

    let touched = 0;
    let skippedAlreadyMigrated = 0;
    let warnedMalformed = 0;

    for (const row of candidates) {
      const existingMetadata =
        (row.metadata as Record<string, unknown> | null) ?? {};

      // Idempotency guard: already migrated rows would have type='skill'
      // with metadata.trigger. They wouldn't be in this candidate set
      // (type filter is 'workflow'), but a belt-and-braces check is cheap.
      if (
        row.type === 'skill' &&
        existingMetadata.trigger !== undefined &&
        existingMetadata.trigger !== null
      ) {
        skippedAlreadyMigrated += 1;
        continue;
      }

      const newContent = rewriteWorkflowContent(row.content);
      if (newContent === null) {
        console.warn(
          `[migrate-workflow] skip id=${row.id}: malformed frontmatter (no --- block or YAML parse error)`,
        );
        warnedMalformed += 1;
        continue;
      }

      const newMetadata = rewriteMetadata(existingMetadata);

      if (dryRun) {
        console.log(
          `[migrate-workflow] DRY-RUN id=${row.id} would flip type=workflow→skill; trigger.requires_mcps=${JSON.stringify(
            (newMetadata.trigger as Record<string, unknown>).requires_mcps,
          )}`,
        );
      } else {
        await tx
          .update(documents)
          .set({
            type: 'skill',
            content: newContent,
            metadata: newMetadata,
            updatedAt: sql`now()`,
          })
          .where(eq(documents.id, row.id));
      }

      touched += 1;
    }

    // Idempotent counter: also count any rows that were already-skill-with-
    // trigger so operators can see the shape of the DB. These aren't in
    // our candidate set (filtered by type='workflow') so we query separately.
    const alreadyCount = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(documents)
      .where(
        and(
          eq(documents.type, 'skill'),
          isNull(documents.deletedAt),
          sql`${documents.metadata} ? 'trigger'`,
        ),
      );
    skippedAlreadyMigrated += alreadyCount[0]?.n ?? 0;

    // Forward-sweep: already-migrated rows may carry a stale
    // `metadata.type` key from the pre-unification save path (which
    // mirrored frontmatter fields wholesale). The authoritative column is
    // `documents.type`; drop the redundant key so the metadata shape is
    // consistent across old and new rows.
    const stale = (await tx
      .select({ id: documents.id, metadata: documents.metadata })
      .from(documents)
      .where(
        and(
          eq(documents.type, 'skill'),
          isNull(documents.deletedAt),
          sql`${documents.metadata} ? 'type'`,
        ),
      )) as Array<{ id: string; metadata: unknown }>;

    let scrubbedStaleType = 0;
    for (const row of stale) {
      const md = { ...((row.metadata as Record<string, unknown> | null) ?? {}) };
      delete md.type;
      if (dryRun) {
        console.log(`[migrate-workflow] DRY-RUN id=${row.id} would scrub metadata.type`);
      } else {
        await tx
          .update(documents)
          .set({ metadata: md, updatedAt: sql`now()` })
          .where(eq(documents.id, row.id));
      }
      scrubbedStaleType += 1;
    }

    console.log(
      `[migrate-workflow] ${dryRun ? 'DRY-RUN ' : ''}done: touched=${touched} skippedAlreadyMigrated=${skippedAlreadyMigrated} warnedMalformed=${warnedMalformed} scrubbedStaleType=${scrubbedStaleType}`,
    );

    return { touched, skippedAlreadyMigrated, warnedMalformed, scrubbedStaleType };
  });
}

// CLI entrypoint — only runs when invoked directly (pnpm tsx scripts/...).
// The test suite imports `migrate` and bypasses this block.
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(
    `[migrate-workflow] starting ${dryRun ? 'DRY-RUN' : 'APPLY'} pass`,
  );
  try {
    await migrate({ dryRun });
  } finally {
    await pgClient.end();
  }
}

// `require.main === module` is the classic Node entrypoint check. Under
// tsx it resolves correctly; when this file is imported by the test
// suite it evaluates to false and main() never runs.
if (require.main === module) {
  main().catch((err) => {
    console.error('[migrate-workflow] failed:', err);
    process.exitCode = 1;
  });
}

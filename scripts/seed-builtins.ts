/**
 * Seed built-in content (ingestion-filing skill + default agent-scaffolding)
 * for a company.
 *
 * Phase 1.5 Task 10. The two seed documents live as authored Markdown files
 * in `src/db/seeds/`; this script reads them, parses their frontmatter, and
 * inserts them into the `documents` table for the target company. The
 * seeder is idempotent — a company that already has either built-in is
 * left unchanged on that slot — so running it twice (or running it as
 * part of the setup flow after a retry) never duplicates rows.
 *
 * CLI:
 *   npx tsx scripts/seed-builtins.ts --all
 *     Seeds every non-deleted company in the DB. Safe to run repeatedly;
 *     idempotent per company.
 *
 *   npx tsx scripts/seed-builtins.ts --company <companyId>
 *     Seeds one company. Useful after backfill to re-seed a single tenant
 *     that had a partial failure, or as part of a live support session.
 *
 * Library use:
 *   import { seedBuiltins } from '../scripts/seed-builtins';
 *   await seedBuiltins(companyId);
 *
 * Called from the setup wizard (`src/app/(app)/setup/page.tsx`) right
 * after `seedBrainFromUniversalPack` so every new company ships with
 * both built-ins out of the box.
 *
 * Invariants:
 *   - **Idempotence.** A `(companyId, type, slug)` pre-check short-
 *     circuits re-inserts. The `agent-scaffolding` branch also respects
 *     the `documents_company_scaffolding_unique` partial-unique index
 *     (migration 0006) — at most one scaffolding doc per company — so
 *     even a race that bypassed the pre-check would 23505 on the index.
 *   - **No user attribution.** `ownerId` is `null` — these are system
 *     seeds, not authored by any user. Mirrors the Universal Base Pack
 *     seed pattern which leaves `ownerId` unset.
 *   - **No folder.** Built-ins live outside the brain's folder
 *     taxonomy (a founder shouldn't have to know or care that these
 *     docs exist to make the folder tree make sense). `folderId`
 *     is null; `path` is prefixed `.builtins/` so these never collide
 *     with user content under `{folder-slug}/...` or `agents/...`.
 *   - **Manifest rebuild.** After inserting the skill, we fire a
 *     manifest rebuild so the UserPromptSubmit handler can match on
 *     the new `ingestion-filing` slug on the next turn.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { and, eq, isNull } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db, pgClient } from '../src/db';
import { brains, companies, documents } from '../src/db/schema';
import { scheduleManifestRebuild } from '../src/lib/skills/loader';

// ---- Seed file loading ----------------------------------------------------
//
// The seed markdown files live at `src/db/seeds/*.md`. They're read once
// at module-import time so a malformed seed surfaces before any DB call
// rather than at the first `seedBuiltins(...)` invocation.
//
// Path resolution has to survive two very different execution contexts:
//
//   1. `npx tsx scripts/seed-builtins.ts ...` — this file runs as the
//      Node entry point. `import.meta.url` resolves to the on-disk
//      location; reading relative to it works cleanly.
//
//   2. Imported from the Next.js setup wizard (`src/app/(app)/setup/
//      page.tsx`). Under `next dev` / `next start` the bundler may
//      rewrite `import.meta.url`; we cannot rely on it alone. But
//      `process.cwd()` is reliably the repo root under Next.js
//      (this is a documented invariant of both the dev server and
//      the runtime). The `tsx` runner also starts with cwd at the
//      repo root when users invoke the script in the normal way.
//
// Strategy: try `process.cwd()/src/db/seeds` first (fast path, works
// under Next), fall back to the `import.meta.url`-relative location
// (works under direct `tsx` runs from anywhere). The `readFileSync`
// call throws on the fallback only if both paths miss — which would
// mean the file layout has shifted and the seeder itself is broken.

const SEED_FILES = [
  'ingestion-filing-skill.md',
  'default-scaffolding.md',
] as const;

function resolveSeedPath(filename: string): string {
  const cwdCandidate = path.resolve(
    process.cwd(),
    'src',
    'db',
    'seeds',
    filename,
  );
  try {
    readFileSync(cwdCandidate, 'utf8');
    return cwdCandidate;
  } catch {
    // Fall through to the import.meta.url-relative path. If this also
    // misses, `readFileSync` on it throws a descriptive ENOENT pointing
    // at the expected on-disk layout — good signal for debugging.
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', 'src', 'db', 'seeds', filename);
  }
}

interface ParsedSeed {
  filename: string;
  content: string;
  type: string;
  slug: string;
  title: string;
}

/**
 * Parse one seed file: read from disk, split frontmatter from body, pull
 * out the three fields the seeder needs for the uniqueness check + row
 * insert. Throws on malformed seeds — these files ship in the repo and
 * a parse error is a deploy-time bug, not a runtime edge case.
 */
function parseSeedFile(filename: string): ParsedSeed {
  const fullPath = resolveSeedPath(filename);
  const content = readFileSync(fullPath, 'utf8');

  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Seed file ${filename} has no frontmatter block.`);
  }

  const fm = yaml.load(match[1]) as Record<string, unknown> | null;
  if (!fm || typeof fm !== 'object') {
    throw new Error(`Seed file ${filename} frontmatter did not parse.`);
  }

  const type = typeof fm.type === 'string' ? fm.type : '';
  const slug = typeof fm.slug === 'string' ? fm.slug : '';
  const title = typeof fm.title === 'string' ? fm.title : '';

  if (!type || !slug || !title) {
    throw new Error(
      `Seed file ${filename} must define frontmatter 'type', 'slug', and 'title'.`,
    );
  }

  return { filename, content, type, slug, title };
}

// Load once at module import. Errors surface before any DB call, which is
// what we want — an unparseable seed file should abort `seedBuiltins`
// before touching the database.
const PARSED_SEEDS: ParsedSeed[] = SEED_FILES.map(parseSeedFile);

// ---- Public API -----------------------------------------------------------

/**
 * Seed the built-in ingestion-filing skill + default agent-scaffolding
 * for `companyId`. Idempotent — docs that already exist (matched by
 * `(companyId, type, slug)`) are left unchanged.
 *
 * After inserting the skill doc, a manifest rebuild is scheduled so the
 * UserPromptSubmit handler picks up the new skill on the next turn.
 *
 * Throws only on infrastructure errors (no brain for the company, DB
 * down). All idempotent-branch decisions degrade silently.
 */
export async function seedBuiltins(companyId: string): Promise<void> {
  // Look up the company's brain up-front — every seeded doc needs a
  // brainId, and a company with no brain is a hard error (the setup
  // wizard creates the brain before calling this, and existing companies
  // always have one from Phase 0).
  const [brain] = await db
    .select({ id: brains.id })
    .from(brains)
    .where(and(eq(brains.companyId, companyId), isNull(brains.deletedAt)))
    .limit(1);

  if (!brain) {
    throw new Error(`No brain found for company ${companyId}.`);
  }

  let insertedAny = false;
  let insertedSkill = false;

  for (const seed of PARSED_SEEDS) {
    // Idempotence pre-check: is this built-in already present for the
    // company? Match on (companyId, type, slug) so renaming a seed in
    // the repo would slot in a new doc rather than overwriting the
    // existing one — explicit intent required, no silent surgery.
    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.type, seed.type),
          eq(documents.slug, seed.slug),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      // Already seeded. Skip silently — a re-run is a no-op per the
      // idempotence contract.
      continue;
    }

    await db.insert(documents).values({
      companyId,
      brainId: brain.id,
      // Built-ins live outside the brain's folder taxonomy. Mirrors
      // the agent-definition doc pattern (see `src/app/api/agents/
      // route.ts`) which also uses `folderId: null` for system-
      // authored doc types.
      folderId: null,
      title: seed.title,
      slug: seed.slug,
      // `.builtins/` prefix keeps these outside the `{category}/{slug}`
      // and `agents/{slug}` namespaces. A user could technically create
      // a category called `.builtins` but the leading dot is deliberately
      // filesystem-hostile; the setup wizard's slug regex strips it.
      path: `.builtins/${seed.slug}`,
      content: seed.content,
      summary: null,
      status: 'active',
      confidenceLevel: 'medium',
      isCore: false,
      // No human author — these are system seeds. The universal-pack
      // seeder also leaves owner_id NULL; the column is nullable by
      // design to support this case.
      ownerId: null,
      type: seed.type,
      version: 1,
    });

    insertedAny = true;
    if (seed.type === 'skill') insertedSkill = true;
  }

  // Only fire the manifest rebuild if we actually inserted the skill —
  // re-runs that hit both idempotent branches shouldn't burn a rebuild
  // every time the script is invoked. The 5s debounce would coalesce
  // bursts, but the underlying rebuild still reads every skill doc
  // from Postgres; skipping when nothing changed is cheaper still.
  if (insertedSkill) {
    scheduleManifestRebuild(companyId);
  }

  if (!insertedAny) {
    // Nothing to do. Leaving a breadcrumb in the logs helps when
    // running the backfill — "all 17 companies already seeded" is a
    // useful output.
    console.log(`[seed-builtins] company ${companyId}: already seeded`);
  } else {
    console.log(
      `[seed-builtins] company ${companyId}: seeded ${insertedSkill ? 'skill + ' : ''}built-ins`,
    );
  }
}

// ---- CLI entry point ------------------------------------------------------
//
// Invoked via `npx tsx scripts/seed-builtins.ts ...`. Mirrors the
// pattern in `scripts/backfill-document-type.ts`: parse argv, call the
// seeder, close the postgres client in a `finally` so the process
// exits cleanly.
//
// We only run this block when invoked as a script (i.e. this module is
// the entry point). `import.meta.url === pathToFileURL(process.argv[1])`
// is the canonical check; we compare the fileURL-normalised paths to
// tolerate Windows path separators.

async function cli(): Promise<void> {
  const args = process.argv.slice(2);

  const usage =
    'Usage:\n' +
    '  npx tsx scripts/seed-builtins.ts --all\n' +
    '  npx tsx scripts/seed-builtins.ts --company <companyId>';

  if (args.length === 0) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  if (args[0] === '--all') {
    // companies has no soft-delete column in Phase 0 — every row is
    // live. If future migrations add `companies.deletedAt`, filter
    // here to skip tombstoned tenants.
    const rows = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies);

    console.log(`[seed-builtins] --all: ${rows.length} companies to process`);

    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await seedBuiltins(row.id);
        ok++;
      } catch (err) {
        failed++;
        console.error(
          `[seed-builtins] FAILED for ${row.id} (${row.name}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log(
      `[seed-builtins] --all done: ${ok} ok, ${failed} failed, ${rows.length} total`,
    );
    if (failed > 0) process.exitCode = 1;
    return;
  }

  if (args[0] === '--company') {
    const companyId = args[1];
    if (!companyId) {
      console.error('--company requires a UUID argument.');
      console.error(usage);
      process.exitCode = 1;
      return;
    }
    await seedBuiltins(companyId);
    return;
  }

  console.error(`Unknown argument: ${args[0]}`);
  console.error(usage);
  process.exitCode = 1;
}

// Only run the CLI when this file is the entry point (not when imported).
// The `import.meta.url` / `process.argv[1]` comparison needs a bit of
// normalisation to cope with Windows path separators — we convert
// `process.argv[1]` to a file URL and compare against our own `import.
// meta.url`. On direct `npx tsx path/to/file.ts` they match; on
// library import they don't.
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const entryUrl = new URL(`file://${path.resolve(entry).replace(/\\/g, '/')}`).href;
    const selfUrl = import.meta.url;
    return entryUrl === selfUrl;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  cli()
    .catch((err) => {
      console.error('[seed-builtins] fatal:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pgClient.end();
    });
}

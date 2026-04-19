/**
 * Seed built-in content (ingestion-filing skill, skill-creator skill,
 * + default agent-scaffolding) for a company.
 *
 * Phase 1.5 Task 10 (original). Task 19 refactors skill-type seeds to go
 * through `writeSkillTree` so they share the same document structure as
 * user-authored and GitHub-imported skills.
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
 *   - **Idempotence.**
 *     Classic seeds (agent-scaffolding): checked by (companyId, type, slug).
 *     Skill seeds: checked by (companyId, type='skill', title=name) so the
 *     idempotency key survives slug refactors without duplicating rows.
 *   - **No user attribution.** `ownerId` is `null` — these are system seeds.
 *   - **No folder.** Skill seeds land at `skills/<slug>` (via writeSkillTree);
 *     the scaffolding doc lands at `.builtins/company-scaffolding`.
 *   - **No manifest rebuild.** The manifest system was removed in PR 1.
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { and, eq, isNull } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db, pgClient } from '../src/db';
import { brains, companies, documents } from '../src/db/schema';
import { writeSkillTree } from '../src/lib/skills/write-skill-tree';
import { loadSeedSkill } from '../src/db/seeds/seed-skill-tree';

// ---- Seed configuration ---------------------------------------------------

/**
 * Classic seeds: direct-insert documents that carry their own slug/title in
 * frontmatter. Idempotency is checked by (companyId, type, slug).
 */
const CLASSIC_SEEDS = ['default-scaffolding.md'] as const;

/**
 * Skill seeds: routed through `writeSkillTree`. Each entry is either a
 * single `.md` file (treated as the full skill with no resources) or a
 * directory containing `SKILL.md` + optional `references/*.md` files.
 * Idempotency is checked by (companyId, type='skill', title=name).
 */
const SKILL_SEEDS = [
  { dirOrFile: 'ingestion-filing-skill.md' },
  { dirOrFile: 'skill-creator' },
] as const;

// ---- Classic seed loading --------------------------------------------------
//
// Path resolution: try `process.cwd()/src/db/seeds` first (works under Next.js
// and standard `tsx` runs), fall back to import.meta.url-relative path.

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
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', 'src', 'db', 'seeds', filename);
  }
}

interface ParsedClassicSeed {
  filename: string;
  content: string;
  type: string;
  slug: string;
  title: string;
}

/**
 * Parse a classic seed file: must have `type`, `slug`, and `title` in
 * frontmatter. Throws on malformed seeds.
 */
function parseClassicSeedFile(filename: string): ParsedClassicSeed {
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
      `Classic seed file ${filename} must define frontmatter 'type', 'slug', and 'title'.`,
    );
  }

  return { filename, content, type, slug, title };
}

// Load classic seeds once at module import. Errors surface before any DB call.
const PARSED_CLASSIC_SEEDS: ParsedClassicSeed[] =
  CLASSIC_SEEDS.map(parseClassicSeedFile);

// ---- Public API -----------------------------------------------------------

/**
 * Seed built-in skills and agent-scaffolding for `companyId`. Idempotent.
 *
 * Classic seeds (agent-scaffolding): matched by (companyId, type, slug).
 * Skill seeds (ingestion-filing, skill-creator): matched by
 *   (companyId, type='skill', title=name). Seeded via writeSkillTree so they
 *   share document structure with user-authored and imported skills.
 *
 * Throws only on infrastructure errors (no brain for the company, DB down).
 */
export async function seedBuiltins(companyId: string): Promise<void> {
  const [brain] = await db
    .select({ id: brains.id })
    .from(brains)
    .where(and(eq(brains.companyId, companyId), isNull(brains.deletedAt)))
    .limit(1);

  if (!brain) {
    throw new Error(`No brain found for company ${companyId}.`);
  }

  // ---- Classic seeds (direct insert) -------------------------------------

  for (const seed of PARSED_CLASSIC_SEEDS) {
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

    if (existing) continue;

    await db.insert(documents).values({
      companyId,
      brainId: brain.id,
      folderId: null,
      title: seed.title,
      slug: seed.slug,
      path: `.builtins/${seed.slug}`,
      content: seed.content,
      summary: null,
      status: 'active',
      confidenceLevel: 'medium',
      isCore: false,
      ownerId: null,
      type: seed.type,
      version: 1,
    });
  }

  // ---- Skill seeds (via writeSkillTree) ----------------------------------

  await seedSkillBuiltins(companyId, brain.id);

  console.log(`[seed-builtins] company ${companyId}: seeded built-ins`);
}

/**
 * Seed only the skill-type built-ins for `companyId`. Called by
 * `seed-skill-creator-for-all-companies.ts` to backfill new skills without
 * re-running the full seedBuiltins (which also touches scaffolding).
 *
 * Exported so the one-off backfill script can call it directly.
 */
export async function seedSkillBuiltins(
  companyId: string,
  brainId?: string,
): Promise<void> {
  // Resolve brainId if not provided.
  let resolvedBrainId = brainId;
  if (!resolvedBrainId) {
    const [brain] = await db
      .select({ id: brains.id })
      .from(brains)
      .where(and(eq(brains.companyId, companyId), isNull(brains.deletedAt)))
      .limit(1);

    if (!brain) {
      throw new Error(`No brain found for company ${companyId}.`);
    }
    resolvedBrainId = brain.id;
  }

  for (const { dirOrFile } of SKILL_SEEDS) {
    const skillData = loadSeedSkill(dirOrFile);

    // Idempotency: check by (companyId, type='skill', title=name).
    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.type, 'skill'),
          eq(documents.title, skillData.name),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (existing) continue;

    await writeSkillTree({
      companyId,
      brainId: resolvedBrainId,
      name: skillData.name,
      description: skillData.description,
      skillMdBody: skillData.skillMdBody,
      resources: skillData.resources,
      // No `source` field — these are seeds, not GitHub imports.
    });
  }
}

// ---- CLI entry point -------------------------------------------------------

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

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const entryUrl = new URL(
      `file://${path.resolve(entry).replace(/\\/g, '/')}`,
    ).href;
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

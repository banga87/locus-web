/**
 * One-off backfill: seed skill built-ins (ingestion-filing + skill-creator)
 * for every existing company.
 *
 * Idempotent — companies that already have a given skill (matched by
 * (companyId, type='skill', title=name)) are silently skipped. Safe to
 * run repeatedly; it will not duplicate rows.
 *
 * This script seeds only skill-type built-ins via `seedSkillBuiltins`, which
 * is a narrower operation than the full `seedBuiltins` (which also touches
 * default-scaffolding). Use it to backfill new skill seeds without
 * re-running the broader setup flow.
 *
 * CLI:
 *   npx tsx scripts/seed-skill-creator-for-all-companies.ts --all
 *     Seeds every company in the DB.
 *
 *   npx tsx scripts/seed-skill-creator-for-all-companies.ts --company <companyId>
 *     Seeds one company. Useful after backfill to re-seed a single tenant.
 *
 * Post-run verification (run in Supabase SQL editor or psql):
 *
 *   SELECT company_id, count(*) FROM documents
 *     WHERE type = 'skill' AND title = 'skill-creator'
 *     GROUP BY company_id;
 *
 *   Should show one row per company.
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, pgClient } from '../src/db';
import { companies } from '../src/db/schema';
import { seedSkillBuiltins } from './seed-builtins';

// ---- CLI entry point -------------------------------------------------------

async function cli(): Promise<void> {
  const args = process.argv.slice(2);

  const usage =
    'Usage:\n' +
    '  npx tsx scripts/seed-skill-creator-for-all-companies.ts --all\n' +
    '  npx tsx scripts/seed-skill-creator-for-all-companies.ts --company <companyId>';

  if (args.length === 0) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  if (args[0] === '--all') {
    const rows = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies);

    console.log(
      `[seed-skill-creator] --all: ${rows.length} companies to process`,
    );

    let ok = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        await seedSkillBuiltins(row.id);
        ok++;
      } catch (err) {
        failed++;
        console.error(
          `[seed-skill-creator] FAILED for ${row.id} (${row.name}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    console.log(
      `[seed-skill-creator] --all done: ${ok} seeded, ${skipped} skipped, ${failed} failed, ${rows.length} total`,
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
    await seedSkillBuiltins(companyId);
    console.log(`[seed-skill-creator] company ${companyId}: done`);
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
      console.error('[seed-skill-creator] fatal:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pgClient.end();
    });
}

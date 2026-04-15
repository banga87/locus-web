// One-off: regenerate navigation_manifests for every active brain so the
// new nested {folders:[]} shape replaces legacy {categories:[]} content.
// Safe to re-run. Not wired into CI — invoked manually.
//
// Usage:
//   npx tsx scripts/regen-all-manifests.ts
//
// Requires DATABASE_URL in the environment (dotenv picks it up from
// .env automatically via src/db/index.ts).

import 'dotenv/config';
import { isNull } from 'drizzle-orm';

import { db, pgClient } from '../src/db';
import { brains } from '../src/db/schema';
import { regenerateManifest } from '../src/lib/brain/manifest';

async function main(): Promise<void> {
  const rows = await db
    .select({ id: brains.id, name: brains.name })
    .from(brains)
    .where(isNull(brains.deletedAt));

  console.log(`Found ${rows.length} active brains. Regenerating manifests…`);

  for (const b of rows) {
    console.log(`  ${b.name} (${b.id})…`);
    await regenerateManifest(b.id);
  }

  console.log(`Done: ${rows.length} brains regenerated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Close the postgres client so the process exits cleanly.
    await pgClient.end();
  });

// Seed a fresh brain with the Universal Base Pack: seven top-level folders,
// no documents. Called from the setup wizard right after creating the
// company + brain, inside the same transaction boundary.
//
// Safety: wrapped in a Drizzle transaction so a mid-seed failure doesn't
// leave a half-populated brain.

import { db } from '@/db';
import { folders } from '@/db/schema';
import { regenerateManifest } from '@/lib/brain/manifest';
import { seedDefaultVocabulary } from '@/lib/taxonomy/seed';

import { UNIVERSAL_PACK } from './universal-pack';

export async function seedBrainFromUniversalPack(
  brainId: string,
  companyId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const folder of UNIVERSAL_PACK.folders) {
      await tx
        .insert(folders)
        .values({
          brainId,
          companyId,
          parentId: folder.parentId,
          slug: folder.slug,
          name: folder.name,
          description: folder.description,
          sortOrder: folder.sortOrder,
          path: folder.path,
        });
    }
  });

  await seedDefaultVocabulary(brainId);

  // Regenerate the navigation manifest outside the seed transaction. If
  // this fails the seed itself is already committed — the next write to
  // this brain will rebuild it, so we don't need to roll back.
  await regenerateManifest(brainId);
}

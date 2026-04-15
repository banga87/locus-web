// Seed a fresh brain with the Universal Base Pack: four top-level folders,
// ten core documents. Called from the setup wizard right after creating
// the company + brain, inside the same transaction boundary.
//
// Safety: wrapped in a Drizzle transaction so a mid-seed failure doesn't
// leave a half-populated brain. The immutability trigger on
// document_versions doesn't apply here — we never insert versions during
// seeding, only the authoritative `documents` rows.

import { db } from '@/db';
import { documents, folders } from '@/db/schema';
import { regenerateManifest } from '@/lib/brain/manifest';

import { UNIVERSAL_PACK } from './universal-pack';

export async function seedBrainFromUniversalPack(
  brainId: string,
  companyId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Insert folders first and keep slug -> id in memory so we can
    // resolve each document's folderId without a second round-trip.
    const folderMap = new Map<string, string>();

    for (const folder of UNIVERSAL_PACK.folders) {
      const [created] = await tx
        .insert(folders)
        .values({
          brainId,
          companyId,
          parentId: folder.parentId,
          slug: folder.slug,
          name: folder.name,
          description: folder.description,
          sortOrder: folder.sortOrder,
        })
        .returning({ id: folders.id });
      folderMap.set(folder.slug, created.id);
    }

    for (const tmpl of UNIVERSAL_PACK.documents) {
      const folderId = folderMap.get(tmpl.folder);
      if (!folderId) {
        // Defensive: a template document referencing a folder we didn't
        // define would be a bug in universal-pack.ts, not bad input.
        throw new Error(
          `Universal Pack document "${tmpl.slug}" references unknown folder "${tmpl.folder}".`,
        );
      }

      // Markdown body: one `## Heading` per section with the helper text
      // rendered as an HTML comment beneath. Comments hide from rendered
      // output but are easy for the author to pull up in an editor.
      const body = tmpl.sections
        .map(
          (s) =>
            `## ${s.heading}\n\n<!-- ${s.helperText} -->\n\n_Write this section_\n`,
        )
        .join('\n');

      await tx.insert(documents).values({
        brainId,
        companyId,
        folderId,
        title: tmpl.title,
        slug: tmpl.slug,
        path: `${tmpl.folder}/${tmpl.slug}`,
        content: body,
        summary: tmpl.summary,
        status: 'draft',
        isCore: true,
        confidenceLevel: 'medium',
        version: 1,
      });
    }
  });

  // Regenerate the navigation manifest outside the seed transaction. If
  // this fails the seed itself is already committed — the next write to
  // this brain will rebuild it, so we don't need to roll back.
  await regenerateManifest(brainId);
}

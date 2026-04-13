// Seed a fresh brain with the Universal Base Pack: four categories, ten
// core documents. Called from the setup wizard right after creating the
// company + brain, inside the same transaction boundary.
//
// Safety: wrapped in a Drizzle transaction so a mid-seed failure doesn't
// leave a half-populated brain. The immutability trigger on
// document_versions doesn't apply here — we never insert versions during
// seeding, only the authoritative `documents` rows.

import { db } from '@/db';
import { categories, documents } from '@/db/schema';

import { UNIVERSAL_PACK } from './universal-pack';

export async function seedBrainFromUniversalPack(
  brainId: string,
  companyId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Insert categories first and keep slug -> id in memory so we can
    // resolve each document's categoryId without a second round-trip.
    const categoryMap = new Map<string, string>();

    for (const cat of UNIVERSAL_PACK.categories) {
      const [created] = await tx
        .insert(categories)
        .values({
          brainId,
          companyId,
          slug: cat.slug,
          name: cat.name,
          description: cat.description,
          sortOrder: cat.sortOrder,
        })
        .returning({ id: categories.id });
      categoryMap.set(cat.slug, created.id);
    }

    for (const tmpl of UNIVERSAL_PACK.documents) {
      const categoryId = categoryMap.get(tmpl.category);
      if (!categoryId) {
        // Defensive: a template document referencing a category we didn't
        // define would be a bug in universal-pack.ts, not bad input.
        throw new Error(
          `Universal Pack document "${tmpl.slug}" references unknown category "${tmpl.category}".`,
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
        categoryId,
        title: tmpl.title,
        slug: tmpl.slug,
        path: `${tmpl.category}/${tmpl.slug}`,
        content: body,
        summary: tmpl.summary,
        status: 'draft',
        isCore: true,
        confidenceLevel: 'medium',
        version: 1,
      });
    }
  });
}

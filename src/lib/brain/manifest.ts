// Navigation-manifest regeneration.
//
// The manifest is a denormalized snapshot of a brain's categories +
// non-deleted documents, served to agents via get_manifest. We regenerate
// it on every write path (document create/update/delete, category CRUD,
// initial seed) rather than streaming updates: a brain has ~dozens of docs,
// so a full rebuild is cheap and sidesteps a whole class of drift bugs.
//
// No outer transaction on the flip-current + insert: if the UPDATE
// succeeds and the INSERT fails, the next successful regeneration
// recovers (it flips any stragglers to is_current=false before inserting).
// A transient "zero current manifests" window is acceptable because reads
// can always fall back to regenerating on demand.

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import {
  brains,
  categories,
  documents,
  navigationManifests,
} from '@/db/schema';

export interface ManifestDocument {
  path: string;
  title: string;
  summary: string | null;
  confidenceLevel: 'high' | 'medium' | 'low';
  status: 'draft' | 'active' | 'archived';
  isCore: boolean;
  updatedAt: string; // ISO 8601
}

export interface ManifestCategory {
  slug: string;
  name: string;
  description: string | null;
  documents: ManifestDocument[];
}

export interface Manifest {
  generatedAt: string;
  categories: ManifestCategory[];
}

export async function regenerateManifest(brainId: string): Promise<void> {
  // Resolve companyId — navigation_manifests.company_id is NOT NULL. The
  // brain row is the source of truth; callers pass only brainId.
  const [brain] = await db
    .select({ companyId: brains.companyId })
    .from(brains)
    .where(eq(brains.id, brainId))
    .limit(1);

  if (!brain) {
    throw new Error(`regenerateManifest: brain ${brainId} not found`);
  }

  // 1. Fetch categories for the brain, sorted for deterministic output.
  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.brainId, brainId))
    .orderBy(categories.sortOrder);

  // 2. For each category, fetch its non-deleted documents. Issued in
  //    parallel because each query is independent and the category count
  //    is small (universal pack ships 4).
  const manifestCategories: ManifestCategory[] = await Promise.all(
    cats.map(async (cat) => {
      const docs = await db
        .select({
          path: documents.path,
          title: documents.title,
          summary: documents.summary,
          confidenceLevel: documents.confidenceLevel,
          status: documents.status,
          isCore: documents.isCore,
          updatedAt: documents.updatedAt,
        })
        .from(documents)
        .where(
          and(
            eq(documents.categoryId, cat.id),
            isNull(documents.deletedAt),
          ),
        );

      return {
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        documents: docs.map((d) => ({
          path: d.path,
          title: d.title,
          summary: d.summary,
          confidenceLevel: d.confidenceLevel,
          status: d.status,
          isCore: d.isCore,
          updatedAt:
            d.updatedAt instanceof Date
              ? d.updatedAt.toISOString()
              : String(d.updatedAt),
        })),
      };
    }),
  );

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    categories: manifestCategories,
  };

  // 3. Flip any existing current manifests off. Scoped to this brain only.
  await db
    .update(navigationManifests)
    .set({ isCurrent: false })
    .where(eq(navigationManifests.brainId, brainId));

  // 4. Insert the new current manifest.
  await db.insert(navigationManifests).values({
    companyId: brain.companyId,
    brainId,
    content: manifest,
    isCurrent: true,
  });
}

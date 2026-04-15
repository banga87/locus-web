// Shared seed/read helpers for the regenerateManifest test suites.
//
// `seedBrainWithNestedFolders` creates a fresh company + brain with a
// two-level folder hierarchy plus a skill-typed document used to assert
// the type-exclusion filter. Cleanup is best-effort via the suffix list:
// callers can either rely on the brain-cascade in `afterAll`, or invoke
// `cleanupSeed` directly.
//
// Mirrors the `manifest.test.ts` suffix/teardown convention so the two
// suites can run side-by-side without colliding.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import {
  brains,
  companies,
  documents,
  folders,
  navigationManifests,
} from '@/db/schema';

import type { Manifest } from '../manifest';

export interface SeedHandle {
  companyId: string;
  brainId: string;
  brandFolderId: string;
  productFolderId: string;
  terravoltFolderId: string;
  suffix: string;
}

const created: SeedHandle[] = [];

export async function seedBrainWithNestedFolders(): Promise<string> {
  const suffix = `nested-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({
      name: `Nested Manifest Co ${suffix}`,
      slug: `nested-${suffix}`,
    })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({
      companyId: company.id,
      name: 'Main Brain',
      slug: 'main',
    })
    .returning({ id: brains.id });

  const [brandFolder] = await db
    .insert(folders)
    .values({
      companyId: company.id,
      brainId: brain.id,
      slug: 'brand-identity',
      name: 'Brand & Identity',
      description: 'Voice, tone, and visuals.',
      sortOrder: 0,
    })
    .returning({ id: folders.id });

  const [productFolder] = await db
    .insert(folders)
    .values({
      companyId: company.id,
      brainId: brain.id,
      slug: 'product-service',
      name: 'Product & Service',
      description: 'What we sell.',
      sortOrder: 1,
    })
    .returning({ id: folders.id });

  const [terravoltFolder] = await db
    .insert(folders)
    .values({
      companyId: company.id,
      brainId: brain.id,
      parentId: productFolder.id,
      slug: 'terravolt-products',
      name: 'Terravolt Products',
      description: 'The Terravolt range.',
      sortOrder: 0,
    })
    .returning({ id: folders.id });

  // Brand: 1 knowledge doc + 1 skill-typed doc (the latter must be
  // excluded from the manifest).
  await db.insert(documents).values([
    {
      companyId: company.id,
      brainId: brain.id,
      folderId: brandFolder.id,
      title: 'Brand Voice Guide',
      slug: `brand-voice-${suffix}`,
      path: `brand-identity/brand-voice-${suffix}`,
      content: '# Brand Voice',
      summary: 'How we sound.',
      status: 'active',
      confidenceLevel: 'high',
      isCore: true,
      isPinned: true,
    },
    {
      companyId: company.id,
      brainId: brain.id,
      folderId: brandFolder.id,
      title: 'Skill Doc',
      slug: `skill-doc-${suffix}`,
      path: `brand-identity/skill-doc-${suffix}`,
      content: '# Skill',
      type: 'skill',
      status: 'active',
      confidenceLevel: 'medium',
    },
  ]);

  // Terravolt: 2 nested-folder documents.
  await db.insert(documents).values([
    {
      companyId: company.id,
      brainId: brain.id,
      folderId: terravoltFolder.id,
      title: 'Terravolt Mini',
      slug: `terravolt-mini-${suffix}`,
      path: `product-service/terravolt-products/terravolt-mini-${suffix}`,
      content: '# Mini',
      summary: 'Entry-level.',
      status: 'active',
      confidenceLevel: 'high',
      isCore: false,
      isPinned: false,
    },
    {
      companyId: company.id,
      brainId: brain.id,
      folderId: terravoltFolder.id,
      title: 'Terravolt Max',
      slug: `terravolt-max-${suffix}`,
      path: `product-service/terravolt-products/terravolt-max-${suffix}`,
      content: '# Max',
      summary: 'Flagship.',
      status: 'draft',
      confidenceLevel: 'medium',
      isCore: false,
      isPinned: true,
    },
  ]);

  created.push({
    companyId: company.id,
    brainId: brain.id,
    brandFolderId: brandFolder.id,
    productFolderId: productFolder.id,
    terravoltFolderId: terravoltFolder.id,
    suffix,
  });

  return brain.id;
}

export async function readCurrentManifest(brainId: string): Promise<Manifest> {
  const [row] = await db
    .select({ content: navigationManifests.content })
    .from(navigationManifests)
    .where(eq(navigationManifests.brainId, brainId))
    .limit(1);

  if (!row) {
    throw new Error(`readCurrentManifest: no manifest row for brain ${brainId}`);
  }
  return row.content as Manifest;
}

export async function cleanupSeeds(): Promise<void> {
  // Cascade via brain → companies. parent_id has RESTRICT on delete, so
  // wipe nested folders first by deleting documents (no-op cascade) and
  // then folders bottom-up. Easier: rely on brain cascade for
  // documents/manifests, then delete folders explicitly children-first.
  for (const s of created.splice(0)) {
    // documents + navigation_manifests cascade with brain.
    await db.delete(brains).where(eq(brains.id, s.brainId));
    // folders cascade off brain too (brainId FK is cascade), so the
    // brain delete handles them. Finally drop the company.
    await db.delete(companies).where(eq(companies.id, s.companyId));
  }
}

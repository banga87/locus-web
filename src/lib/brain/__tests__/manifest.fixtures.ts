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

import { and, eq, isNotNull } from 'drizzle-orm';

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

  // Brand: 1 knowledge doc + 1 skill-typed doc (excluded from manifest)
  // + 1 workflow-typed doc (INCLUDED — the Platform Agent must be able to
  // reference workflow definitions by name via the manifest).
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
    {
      companyId: company.id,
      brainId: brain.id,
      folderId: brandFolder.id,
      title: 'Pricing Model',
      slug: `pricing-model-${suffix}`,
      path: `brand-identity/pricing-model-${suffix}`,
      content: '# Pricing',
      // User-authored vocabulary type. Not in MANIFEST_EXCLUDED_TYPES, so
      // this row MUST appear in the manifest — the test asserts that below.
      type: 'pricing-model',
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
    .where(
      and(
        eq(navigationManifests.brainId, brainId),
        eq(navigationManifests.isCurrent, true),
      ),
    )
    .limit(1);

  if (!row) {
    throw new Error(`readCurrentManifest: no manifest row for brain ${brainId}`);
  }
  return row.content as Manifest;
}

export async function cleanupSeeds(): Promise<void> {
  // folders.parent_id has ON DELETE RESTRICT, so a brain-cascade that
  // tries to drop the parent folder while a child still references it
  // will fail. Delete nested folders explicitly first, then top-level
  // folders, then the brain (which cascades documents + manifests),
  // then the company.
  for (const s of created.splice(0)) {
    await db
      .delete(folders)
      .where(
        and(eq(folders.brainId, s.brainId), isNotNull(folders.parentId)),
      );
    await db.delete(folders).where(eq(folders.brainId, s.brainId));
    await db.delete(brains).where(eq(brains.id, s.brainId));
    await db.delete(companies).where(eq(companies.id, s.companyId));
  }
}

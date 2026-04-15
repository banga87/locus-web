// regenerateManifest tests — exercise the real function against live
// Supabase. We seed a scratch brain per run, assert the manifest row is
// inserted + marked current, and confirm the flip-previous-off behaviour
// on a second regeneration.
//
// Teardown: navigation_manifests has no immutability trigger, so a plain
// cascade-delete via the brain works; mirrors the shared `_fixtures`
// teardown pattern.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import {
  brains,
  companies,
  documents,
  folders,
  navigationManifests,
} from '@/db/schema';

import { regenerateManifest, type Manifest } from '../manifest';

interface LocalFixtures {
  companyId: string;
  brainId: string;
  brandFolderId: string;
  pricingFolderId: string;
  emptyBrainId: string;
  emptyCompanyId: string;
  suffix: string;
}

let f: LocalFixtures;

beforeAll(async () => {
  const suffix = `manifest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Manifest Test Co ${suffix}`, slug: `mf-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company.id, name: 'Main Brain', slug: 'main' })
    .returning({ id: brains.id });

  // Two top-level folders with explicit sort order so we can assert
  // stable output.
  const [brandFolder] = await db
    .insert(folders)
    .values({
      companyId: company.id,
      brainId: brain.id,
      slug: 'brand',
      name: 'Brand & Voice',
      description: 'How we sound.',
      sortOrder: 0,
    })
    .returning({ id: folders.id });

  const [pricingFolder] = await db
    .insert(folders)
    .values({
      companyId: company.id,
      brainId: brain.id,
      slug: 'pricing',
      name: 'Pricing',
      description: null,
      sortOrder: 1,
    })
    .returning({ id: folders.id });

  // Three documents: two in brand, one in pricing. One of the brand docs
  // is soft-deleted to assert the deletedAt filter.
  await db.insert(documents).values([
    {
      companyId: company.id,
      brainId: brain.id,
      folderId: brandFolder.id,
      title: 'Brand Voice Guide',
      slug: `brand-voice-${suffix}`,
      path: `brand/brand-voice-${suffix}`,
      content: '# Brand Voice',
      summary: 'How we speak.',
      status: 'active',
      confidenceLevel: 'high',
      isCore: true,
    },
    {
      companyId: company.id,
      brainId: brain.id,
      folderId: brandFolder.id,
      title: 'Logo Usage',
      slug: `logo-usage-${suffix}`,
      path: `brand/logo-usage-${suffix}`,
      content: '# Logo',
      status: 'draft',
      confidenceLevel: 'medium',
      isCore: false,
    },
    {
      companyId: company.id,
      brainId: brain.id,
      folderId: pricingFolder.id,
      title: 'Plans',
      slug: `plans-${suffix}`,
      path: `pricing/plans-${suffix}`,
      content: '# Plans',
      summary: null,
      status: 'active',
      confidenceLevel: 'low',
      isCore: true,
    },
    // Soft-deleted — must NOT appear in the manifest.
    {
      companyId: company.id,
      brainId: brain.id,
      folderId: brandFolder.id,
      title: 'Old Logo',
      slug: `old-logo-${suffix}`,
      path: `brand/old-logo-${suffix}`,
      content: '# Old',
      status: 'archived',
      deletedAt: new Date(),
    },
  ]);

  // Second brain with no folders/documents for the empty-manifest test.
  const [emptyCompany] = await db
    .insert(companies)
    .values({ name: `Empty Co ${suffix}`, slug: `empty-${suffix}` })
    .returning({ id: companies.id });

  const [emptyBrain] = await db
    .insert(brains)
    .values({
      companyId: emptyCompany.id,
      name: 'Empty Brain',
      slug: 'empty',
    })
    .returning({ id: brains.id });

  f = {
    companyId: company.id,
    brainId: brain.id,
    brandFolderId: brandFolder.id,
    pricingFolderId: pricingFolder.id,
    emptyBrainId: emptyBrain.id,
    emptyCompanyId: emptyCompany.id,
    suffix,
  };
});

afterAll(async () => {
  // Cascade via brains: documents + folders + navigation_manifests all
  // reference brain_id with onDelete cascade. document_versions has the
  // immutability trigger but we don't create versions here, so no need to
  // disable it.
  await db.delete(brains).where(eq(brains.id, f.brainId));
  await db.delete(brains).where(eq(brains.id, f.emptyBrainId));
  await db.delete(companies).where(eq(companies.id, f.companyId));
  await db.delete(companies).where(eq(companies.id, f.emptyCompanyId));
});

describe('regenerateManifest', () => {
  it('inserts a current manifest row with folders in sortOrder', async () => {
    await regenerateManifest(f.brainId);

    const rows = await db
      .select()
      .from(navigationManifests)
      .where(eq(navigationManifests.brainId, f.brainId));

    const current = rows.filter((r) => r.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].companyId).toBe(f.companyId);

    const manifest = current[0].content as Manifest;
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(manifest.folders).toHaveLength(2);
    expect(manifest.folders[0].slug).toBe('brand');
    expect(manifest.folders[1].slug).toBe('pricing');

    const brand = manifest.folders[0];
    expect(brand.name).toBe('Brand & Voice');
    expect(brand.description).toBe('How we sound.');
    // Two live docs in brand; the soft-deleted "old-logo" must be excluded.
    expect(brand.documents).toHaveLength(2);
    const brandPaths = brand.documents.map((d) => d.path).sort();
    expect(brandPaths).toEqual(
      [`brand/brand-voice-${f.suffix}`, `brand/logo-usage-${f.suffix}`].sort(),
    );
    for (const d of brand.documents) {
      expect(d.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    const pricing = manifest.folders[1];
    expect(pricing.description).toBeNull();
    expect(pricing.documents).toHaveLength(1);
    expect(pricing.documents[0]).toMatchObject({
      path: `pricing/plans-${f.suffix}`,
      title: 'Plans',
      summary: null,
      confidenceLevel: 'low',
      status: 'active',
      isCore: true,
    });
  });

  it('flips previous manifest to isCurrent=false on re-regeneration', async () => {
    // (First regen happened in the previous test. Run again and assert
    //  exactly one current row remains, and the earlier row is now stale.)
    await regenerateManifest(f.brainId);

    const rows = await db
      .select()
      .from(navigationManifests)
      .where(eq(navigationManifests.brainId, f.brainId))
      .orderBy(desc(navigationManifests.createdAt));

    const current = rows.filter((r) => r.isCurrent);
    const stale = rows.filter((r) => !r.isCurrent);

    expect(current).toHaveLength(1);
    expect(stale.length).toBeGreaterThanOrEqual(1);
    // Newest row is the current one.
    expect(rows[0].isCurrent).toBe(true);
  });

  it('emits empty folders[] for a brain with no folders', async () => {
    await regenerateManifest(f.emptyBrainId);

    const [row] = await db
      .select()
      .from(navigationManifests)
      .where(
        and(
          eq(navigationManifests.brainId, f.emptyBrainId),
          eq(navigationManifests.isCurrent, true),
        ),
      )
      .limit(1);

    expect(row).toBeDefined();
    const manifest = row.content as Manifest;
    expect(manifest.folders).toEqual([]);
  });

  it('emits empty documents[] for a folder with no live docs', async () => {
    // Create a transient empty folder on the main brain, regen, then
    // drop it so the next suite run is clean-ish. (Teardown also catches
    // it via brain-cascade.)
    const emptySlug = `empty-folder-${randomUUID().slice(0, 6)}`;
    const [emptyFolder] = await db
      .insert(folders)
      .values({
        companyId: f.companyId,
        brainId: f.brainId,
        slug: emptySlug,
        name: 'Empty Folder',
        sortOrder: 99,
      })
      .returning({ id: folders.id });

    await regenerateManifest(f.brainId);

    const [row] = await db
      .select()
      .from(navigationManifests)
      .where(
        and(
          eq(navigationManifests.brainId, f.brainId),
          eq(navigationManifests.isCurrent, true),
        ),
      )
      .limit(1);

    const manifest = row.content as Manifest;
    const emptyEntry = manifest.folders.find((c) => c.slug === emptySlug);
    expect(emptyEntry).toBeDefined();
    expect(emptyEntry!.documents).toEqual([]);

    // Cleanup this ad-hoc folder eagerly to keep teardown simple.
    await db.delete(folders).where(eq(folders.id, emptyFolder.id));
  });
});

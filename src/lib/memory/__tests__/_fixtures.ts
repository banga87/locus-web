// Memory subsystem test fixtures. Builds on the shared
// setupFixtures/teardownFixtures from src/lib/tools/__tests__/_fixtures.ts
// for company/brain/folder/owner setup, then seeds documents WITH
// compact_index populated (via the rule-based extractor) so retrieval
// tests exercise both the tsvector trigger and the compact_index path.
//
// Each helper returns a typed context with the IDs the test needs.

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { companies } from '@/db/schema/companies';
import { documents } from '@/db/schema/documents';
import { users } from '@/db/schema/users';

import { extractCompactIndex } from '../compact-index/extract';

export interface SeedDocInput {
  title: string;
  content: string;
  // Optional — defaults to the brain's pricing folder so the seeded
  // doc has a folder and a path.
  folderSlug?: string;
}

export interface SeededBrain {
  companyId: string;
  brainId: string;
  folderId: string;
  ownerUserId: string;
  suffix: string;
  docs: Array<{ id: string; slug: string; title: string }>;
}

async function seedCompanyBrainAndFolder(label: string): Promise<{
  companyId: string;
  brainId: string;
  folderId: string;
  ownerUserId: string;
  suffix: string;
}> {
  const suffix = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Mem Test Co ${suffix}`, slug: `mem-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company.id, name: 'Main', slug: 'main' })
    .returning({ id: brains.id });

  const [folder] = await db
    .insert(folders)
    .values({
      companyId: company.id,
      brainId: brain.id,
      slug: 'pricing',
      name: 'Pricing',
    })
    .returning({ id: folders.id });

  const ownerId = randomUUID();
  await db.insert(users).values({
    id: ownerId,
    companyId: company.id,
    fullName: 'Test Owner',
    email: `owner-${suffix}@example.test`,
    status: 'active',
  });

  return {
    companyId: company.id,
    brainId: brain.id,
    folderId: folder.id,
    ownerUserId: ownerId,
    suffix,
  };
}

export async function seedBrainInCompany(opts: {
  docs: SeedDocInput[];
}): Promise<SeededBrain> {
  const base = await seedCompanyBrainAndFolder('mem');

  const seeded: SeededBrain['docs'] = [];
  for (let i = 0; i < opts.docs.length; i++) {
    const d = opts.docs[i];
    const slug = `seed-${base.suffix}-${i}`;
    const ci = extractCompactIndex(d.content, { entities: [] });
    const [row] = await db
      .insert(documents)
      .values({
        companyId: base.companyId,
        brainId: base.brainId,
        folderId: base.folderId,
        title: d.title,
        slug,
        path: `pricing/${slug}`,
        content: d.content,
        status: 'active',
        ownerId: base.ownerUserId,
        compactIndex: ci,
      })
      .returning({ id: documents.id });
    seeded.push({ id: row.id, slug, title: d.title });
  }

  return { ...base, docs: seeded };
}

export interface TwoDocsCtx {
  companyId: string;
  brainId: string;
  ownerUserId: string;
  docAId: string;
  docBId: string;
  docASlug: string;
  docBSlug: string;
}

export async function seedTwoDocumentsInOneBrain(opts: {
  docA: SeedDocInput;
  docB: SeedDocInput;
}): Promise<TwoDocsCtx> {
  const seeded = await seedBrainInCompany({ docs: [opts.docA, opts.docB] });
  return {
    companyId: seeded.companyId,
    brainId: seeded.brainId,
    ownerUserId: seeded.ownerUserId,
    docAId: seeded.docs[0].id,
    docBId: seeded.docs[1].id,
    docASlug: seeded.docs[0].slug,
    docBSlug: seeded.docs[1].slug,
  };
}

export async function teardownSeed(b: SeededBrain | TwoDocsCtx): Promise<void> {
  // Replicate the teardown semantics from src/lib/tools/__tests__/_fixtures.ts:
  // brains cascades to docs + folders, but document_versions has an
  // immutability trigger we briefly disable. Users have FK on companies
  // with ON DELETE RESTRICT, so the user must be deleted before the
  // company even though the brain cascade does not reach it.
  await db.delete(users).where(eq(users.id, b.ownerUserId));
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, b.brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, b.companyId));
}

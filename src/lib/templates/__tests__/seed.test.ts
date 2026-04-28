// Live-DB tests for seedBrainFromUniversalPack. Creates a scratch company
// and brain, runs the seeder, asserts the shape of the output, then tears
// the whole thing down via brain-cascade.
//
// We briefly disable the document_versions immutability trigger during
// teardown so the cascade can reach through that table. Seeding itself
// never inserts into document_versions, so the trigger isn't engaged
// during the happy path.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { brains, companies, documents, folders } from '@/db/schema';

import { seedBrainFromUniversalPack } from '../seed';

let companyId: string;
let brainId: string;

beforeAll(async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Seed Test Co ${suffix}`, slug: `seed-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Main', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  await seedBrainFromUniversalPack(brainId, companyId);
});

afterAll(async () => {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, companyId));
});

describe('seedBrainFromUniversalPack', () => {
  it('creates the seven document-standard folders at the top level', async () => {
    const rows = await db
      .select({ slug: folders.slug, parentId: folders.parentId })
      .from(folders)
      .where(eq(folders.brainId, brainId));
    const top = rows.filter((r) => r.parentId === null).map((r) => r.slug).sort();
    expect(top).toEqual([
      'company',
      'customers',
      'market',
      'marketing',
      'operations',
      'product',
      'signals',
    ]);
  });

  it('does not seed any documents (v1 starts empty)', async () => {
    const rows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.brainId, brainId));
    expect(rows).toEqual([]);
  });

  it('seeds the default topic vocabulary into brains.topic_vocabulary', async () => {
    const [row] = await db
      .select({ vocab: brains.topicVocabulary })
      .from(brains)
      .where(eq(brains.id, brainId))
      .limit(1);
    const v = row!.vocab as { terms: string[]; version: number };
    expect(v.terms.length).toBe(33);
    expect(v.version).toBe(1);
  });
});

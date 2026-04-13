// Live-DB tests for seedBrainFromUniversalPack. Creates a scratch company
// and brain, runs the seeder, asserts the shape of the output, then tears
// the whole thing down via brain-cascade.
//
// We briefly disable the document_versions immutability trigger during
// teardown so the cascade can reach through that table. Seeding itself
// never inserts into document_versions, so the trigger isn't engaged
// during the happy path.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { brains, categories, companies, documents } from '@/db/schema';

import { seedBrainFromUniversalPack } from '../seed';
import { UNIVERSAL_PACK } from '../universal-pack';

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
  it('creates exactly four categories with the expected slugs', async () => {
    const rows = await db
      .select({ slug: categories.slug, name: categories.name })
      .from(categories)
      .where(eq(categories.brainId, brainId));

    expect(rows.length).toBe(UNIVERSAL_PACK.categories.length);
    expect(rows.length).toBe(4);

    const slugs = rows.map((r) => r.slug).sort();
    expect(slugs).toEqual(
      [...UNIVERSAL_PACK.categories].map((c) => c.slug).sort(),
    );
  });

  it('creates exactly ten documents, all core and draft', async () => {
    const rows = await db
      .select({
        slug: documents.slug,
        status: documents.status,
        isCore: documents.isCore,
        categoryId: documents.categoryId,
        content: documents.content,
        title: documents.title,
      })
      .from(documents)
      .where(eq(documents.brainId, brainId));

    expect(rows.length).toBe(10);
    expect(rows.length).toBe(UNIVERSAL_PACK.documents.length);

    for (const row of rows) {
      expect(row.status).toBe('draft');
      expect(row.isCore).toBe(true);
      expect(row.categoryId).not.toBeNull();
    }
  });

  it('embeds every section H2 heading in each document body', async () => {
    for (const tmpl of UNIVERSAL_PACK.documents) {
      const [row] = await db
        .select({ content: documents.content })
        .from(documents)
        .where(
          and(eq(documents.brainId, brainId), eq(documents.slug, tmpl.slug)),
        )
        .limit(1);

      expect(row, `missing document ${tmpl.slug}`).toBeDefined();
      for (const section of tmpl.sections) {
        expect(row.content).toContain(`## ${section.heading}`);
      }
    }
  });

  it('links each document to the correct category by slug', async () => {
    const catRows = await db
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(eq(categories.brainId, brainId));
    const slugById = new Map(catRows.map((c) => [c.id, c.slug]));

    const docRows = await db
      .select({ slug: documents.slug, categoryId: documents.categoryId })
      .from(documents)
      .where(eq(documents.brainId, brainId));

    for (const row of docRows) {
      const tmpl = UNIVERSAL_PACK.documents.find((d) => d.slug === row.slug);
      expect(tmpl, `unknown seeded doc ${row.slug}`).toBeDefined();
      expect(slugById.get(row.categoryId!)).toBe(tmpl!.category);
    }
  });
});

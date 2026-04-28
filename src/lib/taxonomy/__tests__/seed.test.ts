// Integration test — hits the live DB via the postgres superuser,
// following the pattern in src/__tests__/integration/helpers.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { brains, companies } from '@/db/schema';
import { seedDefaultVocabulary } from '../seed';
import { DEFAULT_TERMS, DEFAULT_SYNONYMS } from '../default-vocabulary';

describe('seedDefaultVocabulary', () => {
  let companyId: string;
  let brainId: string;

  beforeAll(async () => {
    const slug = `tax-seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [c] = await db
      .insert(companies)
      .values({ name: `Tax seed ${slug}`, slug })
      .returning({ id: companies.id });
    companyId = c.id;

    const [b] = await db
      .insert(brains)
      .values({
        companyId: c.id,
        name: 'Main',
        slug: 'main',
        description: 'Tax seed test',
      })
      .returning({ id: brains.id });
    brainId = b.id;
  });

  afterAll(async () => {
    if (brainId) await db.delete(brains).where(eq(brains.id, brainId));
    if (companyId)
      await db.delete(companies).where(eq(companies.id, companyId));
  });

  it('writes the 33-term vocabulary into brains.topic_vocabulary', async () => {
    await seedDefaultVocabulary(brainId);

    const [row] = await db
      .select({ vocab: brains.topicVocabulary })
      .from(brains)
      .where(eq(brains.id, brainId))
      .limit(1);

    expect(row).toBeTruthy();
    const v = row!.vocab as {
      terms: string[];
      synonyms: Record<string, string>;
      version: number;
    };
    expect(v.terms).toEqual(DEFAULT_TERMS);
    expect(v.synonyms).toEqual(DEFAULT_SYNONYMS);
    expect(v.version).toBe(1);
  });
});

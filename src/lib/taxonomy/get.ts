// Read the workspace vocabulary from `brains.topic_vocabulary`. Empty
// or missing returns the default — this is the canary case where a
// brain was created before the seed migration; treating it as "use
// defaults" lets the system stay functional during rollout.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { brains } from '@/db/schema';

import { DEFAULT_VOCABULARY } from './default-vocabulary';
import type { Vocabulary } from './types';

export async function getTaxonomy(brainId: string): Promise<Vocabulary> {
  const [row] = await db
    .select({ topicVocabulary: brains.topicVocabulary })
    .from(brains)
    .where(eq(brains.id, brainId))
    .limit(1);

  if (!row) {
    throw new Error(`brain not found: ${brainId}`);
  }

  const stored = row.topicVocabulary as Partial<Vocabulary> | null;

  if (
    stored &&
    Array.isArray(stored.terms) &&
    stored.terms.length > 0 &&
    typeof stored.version === 'number'
  ) {
    return {
      terms: stored.terms,
      synonyms: (stored.synonyms ?? {}) as Record<string, string>,
      version: stored.version,
    };
  }

  // Pre-seed brain — fall back to the default. The seed function
  // populates this on next provisioning; old brains are migrated by
  // re-running scripts/seed-builtins.ts (or the equivalent backfill).
  return DEFAULT_VOCABULARY;
}

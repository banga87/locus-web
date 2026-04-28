// Seed the workspace vocabulary at brain provisioning. Idempotent —
// re-runs overwrite the blob without any per-row teardown (this is
// jsonb on a single column, not a separate table). Suitable for
// backfill against existing brains that predate the migration.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { brains } from '@/db/schema';

import { DEFAULT_VOCABULARY } from './default-vocabulary';

export async function seedDefaultVocabulary(brainId: string): Promise<void> {
  await db
    .update(brains)
    .set({ topicVocabulary: DEFAULT_VOCABULARY })
    .where(eq(brains.id, brainId));
}

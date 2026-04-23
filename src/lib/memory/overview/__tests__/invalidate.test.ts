import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { eq, and } from 'drizzle-orm';
import { regenerateFolderOverview } from '../invalidate';
import {
  seedBrainInCompany,
  teardownSeed,
  type SeededBrain,
} from '@/lib/memory/__tests__/_fixtures';

describe('regenerateFolderOverview', () => {
  let ctx: SeededBrain;

  beforeAll(async () => {
    ctx = await seedBrainInCompany({
      docs: [
        { title: 'Enterprise Pricing', content: 'Enterprise tier $50k.' },
      ],
    });
  });

  afterAll(async () => {
    await teardownSeed(ctx);
  });

  it('upserts a type:overview document for the folder', async () => {
    await regenerateFolderOverview({
      companyId: ctx.companyId,
      brainId: ctx.brainId,
      folderPath: 'pricing',
    });

    const [row] = await db
      .select({
        id: documents.id,
        type: documents.type,
        content: documents.content,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(
        and(
          eq(documents.brainId, ctx.brainId),
          eq(documents.slug, '_overview-pricing'),
        ),
      );

    expect(row).toBeDefined();
    expect(row.type).toBe('overview');
    expect(row.content).toContain('Enterprise Pricing');
    expect((row.metadata as { auto_generated?: boolean }).auto_generated).toBe(true);
  });

  it('is idempotent — calling twice updates rather than duplicating', async () => {
    await regenerateFolderOverview({
      companyId: ctx.companyId,
      brainId: ctx.brainId,
      folderPath: 'pricing',
    });

    const rows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.brainId, ctx.brainId),
          eq(documents.slug, '_overview-pricing'),
        ),
      );

    expect(rows.length).toBe(1);
  });
});

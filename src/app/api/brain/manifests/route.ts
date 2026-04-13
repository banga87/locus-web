// GET /api/brain/manifests — current manifest for the caller's brain.
// There is no POST: manifests are regenerated implicitly on writes.

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { navigationManifests } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';

export const GET = () =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const [row] = await db
      .select()
      .from(navigationManifests)
      .where(
        and(
          eq(navigationManifests.brainId, brain.id),
          eq(navigationManifests.isCurrent, true),
        ),
      )
      .limit(1);

    if (!row) return error('not_found', 'No manifest has been generated yet.', 404);
    return success(row);
  });

// DELETE /api/skills/[id]
//
// Soft-deletes the skill root document and all its live resource children in
// a single transaction. Children are explicitly soft-deleted (rather than
// relying on FK cascade) because the FK uses onDelete: 'set null' not
// 'cascade', and we want consistent deletedAt semantics across the tree.
//
// Error mapping:
//   missing/already-deleted skill → 404 not_found
//   not authenticated             → 401 unauthenticated
//   no companyId on profile       → 403 no_company

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';

type RouteCtx = { params: Promise<{ id: string }> };

export const DELETE = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;
    const companyIdOrResponse = requireCompany(ctx);
    if (companyIdOrResponse instanceof Response) return companyIdOrResponse;
    const companyId = companyIdOrResponse;

    // 1. Look up the skill root scoped to this company/brain, not already deleted.
    const brain = await getBrainForCompany(companyId);

    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
          eq(documents.type, 'skill'),
        ),
      )
      .limit(1);

    if (!existing) return error('not_found', 'Skill not found.', 404);

    // 2. Soft-delete root + all live children in one transaction.
    await db.transaction(async (tx) => {
      // Soft-delete all live children first.
      await tx
        .update(documents)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(documents.parentSkillId, id),
            isNull(documents.deletedAt),
          ),
        );

      // Soft-delete the root.
      await tx
        .update(documents)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(documents.id, id));
    });

    return success({ id });
  });

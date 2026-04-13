// PATCH /api/brain/categories/[id] — rename, re-describe, reorder.
//   slug cannot change — document paths depend on it.
// DELETE — Owner only. Documents in the category have categoryId set to null.

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { categories, documents } from '@/db/schema';
import { requireRole } from '@/lib/api/auth';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';

type RouteCtx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field required.');

export const PATCH = (req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    requireRole(ctx, 'editor');
    const { id } = await params;
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_json', 'Request body must be JSON.', 400);
    }

    // Strip slug if present — it is never mutable via PATCH.
    if (body && typeof body === 'object' && 'slug' in body) {
      delete (body as Record<string, unknown>).slug;
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_body', 'Invalid patch.', 400, parsed.error.issues);
    }
    const patch = parsed.data;

    const brain = await getBrainForCompany(companyId);

    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.brainId, brain.id)))
      .limit(1);
    if (!existing) return error('not_found', 'Category not found.', 404);

    const [row] = await db
      .update(categories)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(categories.id, id))
      .returning();

    await tryRegenerateManifest(brain.id);
    return success(row);
  });

export const DELETE = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    requireRole(ctx, 'owner');
    const { id } = await params;
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.brainId, brain.id)))
      .limit(1);
    if (!existing) return error('not_found', 'Category not found.', 404);

    // Orphan documents in the category, then delete the category. The FK
    // already has ON DELETE SET NULL, but we make it explicit for clarity
    // and to be resilient to future FK changes.
    await db
      .update(documents)
      .set({ categoryId: null, updatedAt: new Date() })
      .where(eq(documents.categoryId, id));

    await db.delete(categories).where(eq(categories.id, id));

    await tryRegenerateManifest(brain.id);

    return success({ id });
  });

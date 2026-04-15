// PATCH /api/brain/folders/[id] — rename, re-describe, reorder.
//   slug cannot change — document paths depend on it.
// DELETE — Owner only. Rejects the delete if the folder still contains
// sub-folders or (non-soft-deleted) documents; the caller must move or remove
// children first.

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { documents, folders } from '@/db/schema';
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
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.brainId, brain.id)))
      .limit(1);
    if (!existing) return error('not_found', 'Folder not found.', 404);

    const [row] = await db
      .update(folders)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(folders.id, id))
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
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.brainId, brain.id)))
      .limit(1);
    if (!existing) return error('not_found', 'Folder not found.', 404);

    // Refuse to delete a folder that still has children — the caller must
    // move or delete them first. Check sub-folders before documents so the
    // error message points at the closest problem.
    const [childFolder] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.parentId, id))
      .limit(1);
    if (childFolder) {
      return error(
        'folder_has_children',
        'Folder contains sub-folders. Move or delete them first.',
        409,
      );
    }

    const [childDoc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.folderId, id), isNull(documents.deletedAt)))
      .limit(1);
    if (childDoc) {
      return error(
        'folder_has_documents',
        'Folder contains documents. Move or delete them first.',
        409,
      );
    }

    await db.delete(folders).where(eq(folders.id, id));

    await tryRegenerateManifest(brain.id);

    return success({ id });
  });

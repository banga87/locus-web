// GET /api/brain/folders — list all folders for the caller's brain (flat rows;
// the tree is built client-side). POST — create a new folder. Editor+.
//
// Folders can nest. `parentId: null` is a top-level folder; otherwise it lives
// under another folder in the same brain. Slug uniqueness is scoped by parent —
// two siblings cannot share a slug, but the same slug may appear under
// different parents.

import { and, asc, eq, isNull, max } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { folders } from '@/db/schema';
import { requireRole } from '@/lib/api/auth';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { created, error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';

const SLUG_RE = /^[a-z0-9-]+$/;

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(SLUG_RE, 'slug must match /^[a-z0-9-]+$/'),
  description: z.string().optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const GET = () =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const rows = await db
      .select()
      .from(folders)
      .where(eq(folders.brainId, brain.id))
      .orderBy(asc(folders.sortOrder), asc(folders.name));

    return success(rows);
  });

export const POST = (req: Request) =>
  withAuth(async (ctx) => {
    requireRole(ctx, 'editor');
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_json', 'Request body must be JSON.', 400);
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_body', 'Invalid folder.', 400, parsed.error.issues);
    }
    const input = parsed.data;

    const brain = await getBrainForCompany(companyId);

    // If a parent is specified, make sure it lives in this brain.
    let parentPath: string | null = null;
    if (input.parentId) {
      const [parent] = await db
        .select({ id: folders.id, path: folders.path })
        .from(folders)
        .where(and(eq(folders.id, input.parentId), eq(folders.brainId, brain.id)))
        .limit(1);
      if (!parent) {
        return error('parent_not_found', 'Parent folder not found.', 400);
      }
      parentPath = parent.path;
    }

    // Friendly uniqueness check before hitting the DB constraint. Slug is
    // unique per parent: siblings cannot share, different parents can.
    const [dupe] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(
          eq(folders.brainId, brain.id),
          eq(folders.slug, input.slug),
          input.parentId
            ? eq(folders.parentId, input.parentId)
            : isNull(folders.parentId),
        ),
      )
      .limit(1);
    if (dupe) {
      return error('slug_conflict', 'A folder with that slug already exists.', 409);
    }

    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const [m] = await db
        .select({ max: max(folders.sortOrder) })
        .from(folders)
        .where(
          and(
            eq(folders.brainId, brain.id),
            input.parentId
              ? eq(folders.parentId, input.parentId)
              : isNull(folders.parentId),
          ),
        );
      sortOrder = (m?.max ?? 0) + 10;
    }

    const path = parentPath ? `${parentPath}/${input.slug}` : input.slug;

    try {
      const [row] = await db
        .insert(folders)
        .values({
          companyId,
          brainId: brain.id,
          parentId: input.parentId ?? null,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          sortOrder,
          path,
        })
        .returning();

      await tryRegenerateManifest(brain.id);
      return created(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return error('slug_conflict', 'A folder with that slug already exists.', 409);
      }
      throw e;
    }
  });

// GET /api/brain/categories — list all categories for the caller's brain.
// POST — create a new category. Editor+.

import { and, asc, eq, max } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { categories } from '@/db/schema';
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
  sortOrder: z.number().int().optional(),
});

export const GET = () =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const rows = await db
      .select()
      .from(categories)
      .where(eq(categories.brainId, brain.id))
      .orderBy(asc(categories.sortOrder), asc(categories.name));

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
      return error('invalid_body', 'Invalid category.', 400, parsed.error.issues);
    }
    const input = parsed.data;

    const brain = await getBrainForCompany(companyId);

    // Friendly uniqueness check before hitting the DB constraint.
    const [dupe] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.brainId, brain.id), eq(categories.slug, input.slug)))
      .limit(1);
    if (dupe) {
      return error('slug_conflict', 'A category with that slug already exists.', 409);
    }

    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const [m] = await db
        .select({ max: max(categories.sortOrder) })
        .from(categories)
        .where(eq(categories.brainId, brain.id));
      sortOrder = (m?.max ?? 0) + 10;
    }

    try {
      const [row] = await db
        .insert(categories)
        .values({
          companyId,
          brainId: brain.id,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          sortOrder,
        })
        .returning();

      await tryRegenerateManifest(brain.id);
      return created(row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return error('slug_conflict', 'A category with that slug already exists.', 409);
      }
      throw e;
    }
  });

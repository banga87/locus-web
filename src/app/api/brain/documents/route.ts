// GET /api/brain/documents — list documents for the caller's brain.
// POST /api/brain/documents — create a new (user-authored, non-core) document.
//
// Auth: Viewer+ on GET, Editor+ on POST. All queries scoped by brainId
// (defence in depth — RLS enforces the same boundary at the DB).
//
// POST side-effects: creates an initial `document_versions` row and fires
// a manifest regeneration (best-effort).

import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { categories, documents, documentVersions } from '@/db/schema';
import { requireRole } from '@/lib/api/auth';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { decodeCursor, encodeCursor } from '@/lib/api/pagination';
import { created, error, paginated } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';
import { extractDocumentTypeFromContent } from '@/lib/brain/save';

const SLUG_RE = /^[a-z0-9-]+$/;

const listQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  isCore: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  slug: z.string().regex(SLUG_RE, 'slug must match /^[a-z0-9-]+$/'),
  content: z.string(),
  categoryId: z.string().uuid(),
  summary: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  confidenceLevel: z.enum(['high', 'medium', 'low']).optional(),
});

export const GET = (req: Request) =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) {
      return error('invalid_query', 'Invalid query parameters.', 400, parsed.error.issues);
    }
    const q = parsed.data;

    const brain = await getBrainForCompany(companyId);

    const conds = [eq(documents.brainId, brain.id), isNull(documents.deletedAt)];
    if (q.categoryId) conds.push(eq(documents.categoryId, q.categoryId));
    if (q.status) conds.push(eq(documents.status, q.status));
    if (q.isCore !== undefined) conds.push(eq(documents.isCore, q.isCore === 'true'));

    if (q.cursor) {
      try {
        const cur = decodeCursor<{ updatedAt: string; id: string }>(q.cursor);
        const cursorDate = new Date(cur.updatedAt);
        // (updated_at, id) < (cursorUpdatedAt, cursorId) in desc order
        conds.push(
          or(
            lt(documents.updatedAt, cursorDate),
            and(eq(documents.updatedAt, cursorDate), lt(documents.id, cur.id)),
          )!,
        );
      } catch {
        return error('invalid_cursor', 'Cursor is malformed.', 400);
      }
    }

    const rows = await db
      .select()
      .from(documents)
      .where(and(...conds))
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id })
        : null;

    return paginated(page, nextCursor);
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
      return error('invalid_body', 'Invalid document.', 400, parsed.error.issues);
    }
    const input = parsed.data;

    const brain = await getBrainForCompany(companyId);

    // Category must belong to the same brain.
    const [category] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.brainId, brain.id)))
      .limit(1);
    if (!category) {
      return error('category_not_found', 'Category does not belong to your brain.', 400);
    }

    const path = `${category.slug}/${input.slug}`;

    // Phase 1.5: mirror the frontmatter `type` field into the
    // denormalised column so manifest rebuilds + agent-scaffolding
    // lookups can hit the index instead of parsing content.
    const documentType = extractDocumentTypeFromContent(input.content);

    try {
      const [doc] = await db
        .insert(documents)
        .values({
          companyId,
          brainId: brain.id,
          categoryId: input.categoryId,
          title: input.title,
          slug: input.slug,
          path,
          content: input.content,
          summary: input.summary ?? null,
          status: input.status ?? 'draft',
          confidenceLevel: input.confidenceLevel ?? 'medium',
          isCore: false,
          ownerId: ctx.userId,
          type: documentType,
          version: 1,
        })
        .returning();

      await db.insert(documentVersions).values({
        companyId,
        documentId: doc.id,
        versionNumber: 1,
        content: input.content,
        changeSummary: 'created',
        changedBy: ctx.userId,
        changedByType: 'human',
        metadataSnapshot: {
          title: doc.title,
          status: doc.status,
          confidenceLevel: doc.confidenceLevel,
        },
      });

      await tryRegenerateManifest(brain.id);

      return created(doc);
    } catch (e) {
      // Unique slug violation etc.
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return error('slug_conflict', 'A document with that slug already exists.', 409);
      }
      throw e;
    }
  });

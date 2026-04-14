// GET /api/brain/documents/[id] — fetch a single document with joined
// owner email + category name.
// PATCH — partial update. Increments version, writes a document_versions
// snapshot, rejects `isCore` mutations.
// DELETE — Owner only. Soft-delete. Core documents (is_core = true) are
// rejected with 403.

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { categories, documents, documentVersions, users } from '@/db/schema';
import { requireRole } from '@/lib/api/auth';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';
import { extractDocumentTypeFromContent } from '@/lib/brain/save';

type RouteCtx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    content: z.string().optional(),
    summary: z.string().nullable().optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    confidenceLevel: z.enum(['high', 'medium', 'low']).optional(),
    ownerId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().optional(),
    // isCore is intentionally absent from schema — stripped by Zod via
    // strict parsing below (default zod strips unknown keys).
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field required.');

export const GET = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const [row] = await db
      .select({
        id: documents.id,
        companyId: documents.companyId,
        brainId: documents.brainId,
        categoryId: documents.categoryId,
        categoryName: categories.name,
        title: documents.title,
        slug: documents.slug,
        path: documents.path,
        content: documents.content,
        summary: documents.summary,
        status: documents.status,
        ownerId: documents.ownerId,
        ownerEmail: users.email,
        confidenceLevel: documents.confidenceLevel,
        isCore: documents.isCore,
        version: documents.version,
        tokenEstimate: documents.tokenEstimate,
        tags: documents.tags,
        relatedDocuments: documents.relatedDocuments,
        metadata: documents.metadata,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .leftJoin(categories, eq(documents.categoryId, categories.id))
      .leftJoin(users, eq(documents.ownerId, users.id))
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!row) return error('not_found', 'Document not found.', 404);
    return success(row);
  });

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

    // Explicitly strip isCore if present — it is never user-mutable.
    if (body && typeof body === 'object' && 'isCore' in body) {
      delete (body as Record<string, unknown>).isCore;
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_body', 'Invalid patch.', 400, parsed.error.issues);
    }
    const patch = parsed.data;

    const brain = await getBrainForCompany(companyId);

    const [existing] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return error('not_found', 'Document not found.', 404);

    // Recompute path if category changed.
    let newPath: string | undefined;
    if (patch.categoryId && patch.categoryId !== existing.categoryId) {
      const [cat] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, patch.categoryId), eq(categories.brainId, brain.id)))
        .limit(1);
      if (!cat) {
        return error('category_not_found', 'Category does not belong to your brain.', 400);
      }
      newPath = `${cat.slug}/${existing.slug}`;
    }

    const nextVersion = existing.version + 1;
    const nextContent = patch.content ?? existing.content;

    // Phase 1.5: re-derive the denormalised `type` column from
    // frontmatter whenever content is updated. If the patch leaves
    // content alone, leave the existing `type` alone — no point
    // re-parsing unchanged content.
    const typeUpdate =
      patch.content !== undefined
        ? { type: extractDocumentTypeFromContent(patch.content) }
        : {};

    const changedKeys = Object.keys(patch);
    const summary = `updated: ${changedKeys.join(', ')}`;

    const [updated] = await db
      .update(documents)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.confidenceLevel !== undefined ? { confidenceLevel: patch.confidenceLevel } : {}),
        ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
        ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
        ...(newPath !== undefined ? { path: newPath } : {}),
        ...typeUpdate,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .returning();

    await db.insert(documentVersions).values({
      companyId,
      documentId: id,
      versionNumber: nextVersion,
      content: nextContent,
      changeSummary: summary,
      changedBy: ctx.userId,
      changedByType: 'human',
      metadataSnapshot: {
        title: updated.title,
        status: updated.status,
        confidenceLevel: updated.confidenceLevel,
      },
    });

    await tryRegenerateManifest(brain.id);

    return success(updated);
  });

export const DELETE = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    requireRole(ctx, 'owner');
    const { id } = await params;
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const [existing] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) return error('not_found', 'Document not found.', 404);

    if (existing.isCore) {
      return error('core_document_protected', 'Core documents cannot be deleted.', 403);
    }

    await db
      .update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(documents.id, id));

    await tryRegenerateManifest(brain.id);

    return success({ id });
  });

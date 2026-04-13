// GET /api/brain/documents/[id]/versions — cursor-paginated version list
// for a document. Viewer+.

import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { documents, documentVersions, users } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { decodeCursor, encodeCursor } from '@/lib/api/pagination';
import { error, paginated } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';

type RouteCtx = { params: Promise<{ id: string }> };

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = (req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return error('invalid_query', 'Invalid query.', 400, parsed.error.issues);
    }
    const q = parsed.data;

    const brain = await getBrainForCompany(companyId);

    // Verify the document belongs to this brain before listing.
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!doc) return error('not_found', 'Document not found.', 404);

    const conds = [eq(documentVersions.documentId, id)];
    if (q.cursor) {
      try {
        const cur = decodeCursor<{ createdAt: string }>(q.cursor);
        conds.push(lt(documentVersions.createdAt, new Date(cur.createdAt)));
      } catch {
        return error('invalid_cursor', 'Cursor is malformed.', 400);
      }
    }

    const rows = await db
      .select({
        id: documentVersions.id,
        versionNumber: documentVersions.versionNumber,
        changeSummary: documentVersions.changeSummary,
        changedBy: documentVersions.changedBy,
        changedByEmail: users.email,
        changedByType: documentVersions.changedByType,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      // changedBy is text (user id OR token id OR "system"), so left-join
      // on users yields a name for human actors and null for agents.
      .leftJoin(users, eq(documentVersions.changedBy, users.id))
      .where(and(...conds))
      .orderBy(desc(documentVersions.createdAt))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString() })
        : null;

    return paginated(page, nextCursor);
  });

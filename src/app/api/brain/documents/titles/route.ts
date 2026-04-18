// POST /api/brain/documents/titles — batch-fetch minimal doc metadata by ID.
//
// Purpose: client components (e.g. the run-view OutputCard) need to render
// document titles for a list of IDs that only become known after mount
// (via Supabase Realtime). A full GET /api/brain/documents/[id] per ID is
// wasteful — this batched endpoint returns just {id, title, slug} for up to
// 50 IDs in a single request.
//
// Auth: Viewer+ (any authenticated member of the caller's company).
// Tenant isolation: `WHERE id = ANY($1) AND company_id = $2`. Documents
// from other tenants are silently filtered out — the response shape means
// a missing ID in the result is indistinguishable from "belongs to another
// tenant" or "deleted" or "never existed". This is intentional (no
// cross-tenant existence leakage).
//
// POST not GET: IDs come in a JSON body rather than as query params so a
// run with many output docs doesn't hit URL-length limits.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';

// Hard cap: 50 IDs per request. A workflow run that produces >50 docs is
// an outlier; the client can batch further if it ever needs to.
const MAX_IDS = 50;

const bodySchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1, 'ids must not be empty')
    .max(MAX_IDS, `ids must not exceed ${MAX_IDS}`),
});

export const POST = (req: Request) =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_json', 'Request body must be JSON.', 400);
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return error(
        'invalid_body',
        'Invalid request body.',
        400,
        parsed.error.issues,
      );
    }

    // Dedup client-side IDs so repeat entries don't inflate the query;
    // also guarantees the response ordering is stable.
    const uniqueIds = Array.from(new Set(parsed.data.ids));

    // Tenant-filtered batch read. Excludes soft-deleted docs so a stale
    // UI referencing a deleted doc simply drops it from the output card
    // rather than rendering a broken row.
    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        slug: documents.slug,
      })
      .from(documents)
      .where(
        and(
          inArray(documents.id, uniqueIds),
          // Tenant isolation — the load-bearing check. Without this,
          // any authenticated user could fetch titles for any doc UUID
          // they happened to know, leaking content across companies.
          eq(documents.companyId, companyId),
          isNull(documents.deletedAt),
        ),
      );

    return success({ docs: rows });
  });

// GET /api/brain/[slug]/graph — return the derived graph for a brain.
//
// Slug-scoped lookup prevents cross-company data leak: the WHERE clause
// pins to both the caller's companyId and the requested slug. The
// companyId check is the real security boundary (slug alone is not unique
// across companies); RLS enforces the same boundary at the DB.
//
// Documents with a non-null `type` column (agent-scaffolding, skill,
// agent-definition) are excluded — mirrors the convention in
// GET /api/brain/documents.
//
// Happy-path integration test (live DB, cross-company RLS) is deferred
// to T21. Unit tests cover the 401 and 404 paths.

import { and, eq, isNull } from 'drizzle-orm';
import { NextRequest } from 'next/server';

import { db } from '@/db';
import { brains, documents, folders, mcpConnections } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { error } from '@/lib/api/response';
import { deriveGraph } from '@/lib/graph/derive-graph';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return error(e.code, e.message, e.statusCode);
    }
    throw e;
  }

  if (!ctx.companyId) {
    return error('unauthenticated', 'Sign in required.', 401);
  }

  const { slug } = await params;

  const [brain] = await db
    .select({ id: brains.id, slug: brains.slug, name: brains.name })
    .from(brains)
    .where(
      and(
        eq(brains.companyId, ctx.companyId),
        eq(brains.slug, slug),
        isNull(brains.deletedAt),
      ),
    )
    .limit(1);

  if (!brain) return error('not_found', 'Brain not found.', 404);

  const [docRows, folderRows, mcpRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        slug: documents.slug,
        path: documents.path,
        folderId: documents.folderId,
        isPinned: documents.isPinned,
        confidenceLevel: documents.confidenceLevel,
        tokenEstimate: documents.tokenEstimate,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(
        and(
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
          isNull(documents.type),
        ),
      ),
    db
      .select({
        id: folders.id,
        slug: folders.slug,
        name: folders.name,
        parentId: folders.parentId,
      })
      .from(folders)
      .where(eq(folders.brainId, brain.id)),
    db
      .select({
        id: mcpConnections.id,
        name: mcpConnections.name,
        status: mcpConnections.status,
        serverUrl: mcpConnections.serverUrl,
      })
      .from(mcpConnections)
      .where(eq(mcpConnections.companyId, ctx.companyId)),
  ]);

  const payload = deriveGraph({
    brain,
    docs: docRows.map((d) => ({
      ...d,
      metadata:
        (d.metadata as {
          outbound_links?: Array<{
            target_slug: string;
            source: 'wikilink' | 'markdown_link';
          }>;
        } | null) ?? null,
    })),
    folders: folderRows,
    mcps: mcpRows,
  });

  return Response.json(payload);
}

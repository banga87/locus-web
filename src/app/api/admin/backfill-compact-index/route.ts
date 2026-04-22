// One-shot backfill of compact_index for documents written before
// Task 11 landed. Paginates in batches; each batch is one transaction
// per row (kept simple — backfill is admin-triggered and not on a hot
// path). Invoked manually after migration 0022 is applied.
//
// Route-layer code — Next.js primitives OK here.
//
// Auth: inline requireOwner() stub matching src/app/api/admin/tokens/route.ts.
// Replace with shared requireAuth helper when that lands.

import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { brains, documents, users } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';
import { extractCompactIndex } from '@/lib/memory/compact-index/extract';

export const maxDuration = 300; // 5 min for large corpora

const BATCH_SIZE = 500;

async function requireOwner(): Promise<{ companyId: string } | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const [profile] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (
    !profile ||
    profile.role !== 'owner' ||
    profile.status !== 'active' ||
    !profile.companyId
  ) {
    return new Response('Forbidden', { status: 403 });
  }
  return { companyId: profile.companyId };
}

export async function POST(request: Request) {
  const auth = await requireOwner();
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const brainId = url.searchParams.get('brainId');
  if (!brainId) {
    return NextResponse.json(
      { error: 'brainId query param is required' },
      { status: 400 },
    );
  }

  // Confirm the brain belongs to the caller's company. Without this
  // gate an owner could pass any brainId and rewrite rows in another
  // tenant. Belt-and-suspenders: the WHERE clause below also constrains
  // on company_id so a stale check won't leak either.
  const [brainRow] = await db
    .select({ id: brains.id })
    .from(brains)
    .where(and(eq(brains.id, brainId), eq(brains.companyId, auth.companyId)))
    .limit(1);
  if (!brainRow) {
    return NextResponse.json(
      { error: 'brainId does not belong to your company' },
      { status: 403 },
    );
  }

  let totalUpdated = 0;

  // Loop batches until no rows remain with compact_index IS NULL.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await db
      .select({
        id: documents.id,
        content: documents.content,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(
        and(
          isNull(documents.compactIndex),
          eq(documents.companyId, auth.companyId),
          eq(documents.brainId, brainId),
        ),
      )
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    for (const row of rows) {
      const md = (row.metadata as Record<string, unknown> | null) ?? {};
      const fmEntities = Array.isArray(md.entities)
        ? (md.entities as unknown[]).filter(
            (e): e is string => typeof e === 'string',
          )
        : [];
      const ci = extractCompactIndex(row.content ?? '', { entities: fmEntities });
      await db
        .update(documents)
        .set({ compactIndex: ci })
        .where(eq(documents.id, row.id));
    }

    totalUpdated += rows.length;
  }

  return NextResponse.json({ updated: totalUpdated });
}

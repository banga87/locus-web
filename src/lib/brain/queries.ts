// Brain lookup helpers.
//
// Pre-MVP: one brain per company. The MCP server resolves the caller's
// brain by their token's `companyId`. When multi-brain support lands the
// signature will take an additional brain slug / id.

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { brains, documents } from '@/db/schema';

export async function getBrainForCompany(
  companyId: string,
): Promise<typeof brains.$inferSelect> {
  const [brain] = await db
    .select()
    .from(brains)
    .where(and(eq(brains.companyId, companyId), isNull(brains.deletedAt)))
    .limit(1);

  if (!brain) {
    throw new Error(`No brain found for company ${companyId}`);
  }

  return brain;
}

/**
 * Pinned documents for a brain, ordered by title. Used by the sidebar's
 * Pinned section. The partial index `documents_brain_pinned_idx` makes
 * the lookup cheap. Excludes soft-deleted rows and platform-internal
 * typed documents (agent-scaffolding, agent-definition, skill) — only
 * user-authored knowledge appears in the sidebar.
 */
export async function getPinnedDocuments(input: {
  brainId: string;
}): Promise<Array<{ id: string; title: string; path: string }>> {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      path: documents.path,
    })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, input.brainId),
        eq(documents.isPinned, true),
        isNull(documents.deletedAt),
        isNull(documents.type),
      ),
    )
    .orderBy(documents.title);
  return rows;
}

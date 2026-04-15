import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { brains, documents, folders, mcpConnections } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { deriveGraph, type GraphResponse } from '@/lib/graph/derive-graph';
import { NeuronsClient } from './neurons-client';

export default async function NeuronsPage() {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const [brain] = await db
    .select({ id: brains.id, slug: brains.slug, name: brains.name })
    .from(brains)
    .where(and(eq(brains.companyId, ctx.companyId), isNull(brains.deletedAt)))
    .limit(1);
  if (!brain) return notFound();

  const [docRows, folderRows, mcpRows] = await Promise.all([
    db.select({
      id: documents.id, title: documents.title, slug: documents.slug, path: documents.path,
      folderId: documents.folderId, isPinned: documents.isPinned,
      confidenceLevel: documents.confidenceLevel, tokenEstimate: documents.tokenEstimate,
      metadata: documents.metadata,
    }).from(documents).where(and(
      eq(documents.brainId, brain.id),
      isNull(documents.deletedAt),
      isNull(documents.type),
    )),
    db.select({ id: folders.id, slug: folders.slug, name: folders.name, parentId: folders.parentId })
      .from(folders).where(eq(folders.brainId, brain.id)),
    db.select({ id: mcpConnections.id, name: mcpConnections.name, status: mcpConnections.status, serverUrl: mcpConnections.serverUrl })
      .from(mcpConnections).where(eq(mcpConnections.companyId, ctx.companyId)),
  ]);

  const seedGraph: GraphResponse = deriveGraph({
    brain,
    docs: docRows.map((d) => ({
      ...d,
      metadata: (d.metadata as { outbound_links?: Array<{ target_slug: string; source: 'wikilink' | 'markdown_link' }> } | null) ?? null,
    })),
    folders: folderRows,
    mcps: mcpRows,
  });

  return <NeuronsClient brainId={brain.id} companyId={ctx.companyId} seedGraph={seedGraph} />;
}

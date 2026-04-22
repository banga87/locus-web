// Tatara's in-house hybrid provider. First implementation of
// MemoryProvider. Wraps the Phase 1 retrieval + compact-index + overview
// implementation. Phase 2+ extend this same module with embeddings,
// KG, etc.

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { retrieve } from '../../core';
import { regenerateFolderOverview } from '../../overview/invalidate';
import type {
  CallerContext,
  Doc,
  DocumentWrite,
  Fact,
  FactQuery,
  IngestResult,
  MemoryProvider,
  ProviderCapabilities,
  RankedResult,
  RetrieveQuery,
  Subgraph,
  TraverseQuery,
} from '../../types';

export const tataraHybridProvider: MemoryProvider = {
  retrieve(q: RetrieveQuery, caller?: CallerContext): Promise<RankedResult[]> {
    return retrieve(q, caller);
  },

  async getDocument(): Promise<Doc | null> {
    throw new Error(
      'getDocument: Phase 1 does not implement this via the provider; use the existing get_document tool.',
    );
  },

  async factLookup(_q: FactQuery): Promise<Fact[]> {
    // No KG in Phase 1; returns empty per contract. Phase 3 lands the
    // kg_triples table and wires real lookups.
    return [];
  },

  async timelineFor(): Promise<Fact[]> {
    return [];
  },

  async brainOverview(
    companyId: string,
    brainId: string,
    folderPath = 'root',
  ): Promise<string> {
    // Regenerate-on-read — Phase 1 keeps it simple. Phase 4 caches.
    await regenerateFolderOverview({ companyId, brainId, folderPath });
    const slug = `_overview-${folderPath || 'root'}`;
    const [row] = await db
      .select({ content: documents.content })
      .from(documents)
      .where(
        and(eq(documents.brainId, brainId), eq(documents.slug, slug)),
      )
      .limit(1);
    return row?.content ?? '';
  },

  async graphTraverse(_q: TraverseQuery): Promise<Subgraph> {
    return { nodes: [], edges: [] };
  },

  async ingestDocument(_write: DocumentWrite): Promise<IngestResult> {
    throw new Error(
      'ingestDocument via provider: Phase 1 keeps save logic in src/app/api/brain/documents/*. Phase 3 will route through here.',
    );
  },

  async invalidateDocument(): Promise<void> {
    // No-op in Phase 1. Phase 2+ will invalidate embeddings here.
  },

  describe(): ProviderCapabilities {
    return {
      name: 'tatara-hybrid',
      supports: {
        factLookup: false,
        graphTraverse: false,
        timeline: false,
        embeddings: false,
      },
    };
  },
};

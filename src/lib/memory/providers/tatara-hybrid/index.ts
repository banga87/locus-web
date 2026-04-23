// Tatara's in-house hybrid provider. First implementation of
// MemoryProvider. Wraps the Phase 1 retrieval + compact-index + overview
// implementation. Phase 2+ extend this same module with embeddings,
// KG, etc.

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { brains } from '@/db/schema/brains';
import { documents } from '@/db/schema/documents';
import { retrieve } from '../../core';
import { regenerateFolderOverview } from '../../overview/invalidate';
import { triggerEmbeddingFor } from '../../embedding/trigger';
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
    // Verify (companyId, brainId) is a real tenant tuple before doing
    // anything. Without this gate, a caller passing a bogus pair would
    // cause regenerateFolderOverview to write an overview row stamped
    // with whatever companyId was provided — a data-corruption vector
    // and a cross-tenant leak. Silent empty return (no informative
    // error) to avoid revealing internal state shape to a probing caller.
    const [brainCheck] = await db
      .select({ id: brains.id })
      .from(brains)
      .where(
        and(eq(brains.id, brainId), eq(brains.companyId, companyId)),
      )
      .limit(1);
    if (!brainCheck) return '';

    // Regenerate-on-read — Phase 1 keeps it simple. Phase 4 caches.
    await regenerateFolderOverview({ companyId, brainId, folderPath });
    const slug = `_overview-${folderPath || 'root'}`;
    // Belt-and-suspenders tenancy: scope on company_id AND brain_id AND
    // slug even after the tuple check above.
    const [row] = await db
      .select({ content: documents.content })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.brainId, brainId),
          eq(documents.slug, slug),
        ),
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

  async invalidateDocument(
    slug: string,
    companyId: string,
    brainId: string,
  ): Promise<void> {
    // Resolve slug → documentId via the tenant-scoped read.
    const [row] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.slug, slug),
          eq(documents.companyId, companyId),
          eq(documents.brainId, brainId),
        ),
      )
      .limit(1);
    if (!row) return;                                // unknown slug — silent no-op
    await triggerEmbeddingFor({
      documentId: row.id,
      companyId,
      brainId,
    });
  },

  describe(): ProviderCapabilities {
    return {
      name: 'tatara-hybrid',
      supports: {
        factLookup: false,           // Phase 3
        graphTraverse: false,        // Phase 5
        timeline: false,             // Phase 3
        embeddings: true,            // Phase 2
      },
    };
  },
};

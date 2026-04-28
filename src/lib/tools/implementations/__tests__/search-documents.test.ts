import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { searchDocumentsTool } from '../search-documents';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { eq } from 'drizzle-orm';
import {
  seedBrainInCompany,
  teardownSeed,
  type SeededBrain,
} from '@/lib/memory/__tests__/_fixtures';

describe('search_documents tool (post-refactor)', () => {
  let ctx: SeededBrain;

  beforeAll(async () => {
    ctx = await seedBrainInCompany({
      docs: [{ title: 'A', content: 'Acme pricing terms for enterprise.' }],
    });
  });

  afterAll(async () => {
    await teardownSeed(ctx);
  });

  it('returns provenance in every result', async () => {
    const res = await searchDocumentsTool.call(
      { query: 'Acme' },
      {
        actor: {
          type: 'agent_token',
          id: 'test-token-id',
          scopes: ['read'],
        },
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        grantedCapabilities: [],
        webCallsThisTurn: 0,
      },
    );

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data!.results.length).toBeGreaterThan(0);
    const hit = res.data!.results[0];
    expect(hit.provenance).toBeDefined();
    expect(hit.provenance.brainId).toBe(ctx.brainId);
    expect(hit.provenance.confidenceTier).toBe('extracted');
  });

  it('filters by folder slug', async () => {
    // Seed two docs in the same brain but different folder paths.
    // The fixture's default folder is "pricing" — we create a second
    // doc with a different path prefix to represent a different folder.
    const suffixA = `filter-folder-a-${Date.now()}`;
    const suffixB = `filter-folder-b-${Date.now()}`;
    await db.insert(documents).values([
      {
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        folderId: ctx.folderId,
        title: 'Folder Alpha Doc',
        slug: suffixA,
        path: `alpha/${suffixA}`,
        content: 'folder alpha document about widgets and gadgets',
        status: 'active',
        type: 'note',
        topics: [],
        confidenceLevel: 'medium',
      },
      {
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        folderId: ctx.folderId,
        title: 'Folder Beta Doc',
        slug: suffixB,
        path: `beta/${suffixB}`,
        content: 'folder beta document about widgets and gadgets',
        status: 'active',
        type: 'note',
        topics: [],
        confidenceLevel: 'medium',
      },
    ]);

    try {
      const toolCtx = {
        actor: { type: 'agent_token' as const, id: 'test-token-id', scopes: ['read'] as ['read'] },
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        grantedCapabilities: [] as [],
        webCallsThisTurn: 0,
      };

      const res = await searchDocumentsTool.call(
        { query: 'widgets gadgets', folder: 'alpha' },
        toolCtx,
      );

      expect(res.success).toBe(true);
      if (!res.success) return;
      // Every result must come from the alpha folder.
      for (const r of res.data!.results) {
        expect(r.folder).toBe('alpha');
      }
    } finally {
      await db.delete(documents).where(eq(documents.slug, suffixA));
      await db.delete(documents).where(eq(documents.slug, suffixB));
    }
  });

  it('filters by document type', async () => {
    const suffixC = `filter-type-canonical-${Date.now()}`;
    const suffixN = `filter-type-note-${Date.now()}`;
    await db.insert(documents).values([
      {
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        folderId: ctx.folderId,
        title: 'Canonical Strategy Doc',
        slug: suffixC,
        path: `pricing/${suffixC}`,
        content: 'canonical strategy for brand voice and messaging',
        status: 'active',
        type: 'canonical',
        topics: [],
        confidenceLevel: 'high',
      },
      {
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        folderId: ctx.folderId,
        title: 'Note Strategy Doc',
        slug: suffixN,
        path: `pricing/${suffixN}`,
        content: 'note about brand voice and messaging strategy',
        status: 'active',
        type: 'note',
        topics: [],
        confidenceLevel: 'low',
      },
    ]);

    try {
      const toolCtx = {
        actor: { type: 'agent_token' as const, id: 'test-token-id', scopes: ['read'] as ['read'] },
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        grantedCapabilities: [] as [],
        webCallsThisTurn: 0,
      };

      const res = await searchDocumentsTool.call(
        { query: 'brand voice messaging strategy', type: 'canonical' },
        toolCtx,
      );

      expect(res.success).toBe(true);
      if (!res.success) return;
      // Every result must be type=canonical.
      for (const r of res.data!.results) {
        expect(r.type).toBe('canonical');
      }
      // The canonical doc should appear.
      expect(res.data!.results.some((r) => r.path.includes(suffixC))).toBe(true);
    } finally {
      await db.delete(documents).where(eq(documents.slug, suffixC));
      await db.delete(documents).where(eq(documents.slug, suffixN));
    }
  });

  it('filters by topics (contains-all semantics)', async () => {
    const suffixBV = `filter-topics-bv-${Date.now()}`;
    const suffixB = `filter-topics-b-${Date.now()}`;
    await db.insert(documents).values([
      {
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        folderId: ctx.folderId,
        title: 'Brand Voice Document',
        slug: suffixBV,
        path: `pricing/${suffixBV}`,
        content: 'brand voice document for tone and messaging guidelines',
        status: 'active',
        type: 'canonical',
        topics: ['brand', 'voice'],
        confidenceLevel: 'high',
      },
      {
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        folderId: ctx.folderId,
        title: 'Brand Only Document',
        slug: suffixB,
        path: `pricing/${suffixB}`,
        content: 'brand document for tone and messaging guidelines',
        status: 'active',
        type: 'canonical',
        topics: ['brand'],
        confidenceLevel: 'medium',
      },
    ]);

    try {
      const toolCtx = {
        actor: { type: 'agent_token' as const, id: 'test-token-id', scopes: ['read'] as ['read'] },
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        grantedCapabilities: [] as [],
        webCallsThisTurn: 0,
      };

      // Filter requires BOTH brand AND voice — only the first doc qualifies.
      const res = await searchDocumentsTool.call(
        { query: 'brand voice tone messaging', topics: ['brand', 'voice'] },
        toolCtx,
      );

      expect(res.success).toBe(true);
      if (!res.success) return;
      // Every result must contain both requested topics.
      for (const r of res.data!.results) {
        expect(r.topics).toContain('brand');
        expect(r.topics).toContain('voice');
      }
    } finally {
      await db.delete(documents).where(eq(documents.slug, suffixBV));
      await db.delete(documents).where(eq(documents.slug, suffixB));
    }
  });

  it('filters by confidence_min=medium (returns medium + high)', async () => {
    const suffixLow = `filter-conf-low-${Date.now()}`;
    const suffixMed = `filter-conf-med-${Date.now()}`;
    const suffixHigh = `filter-conf-high-${Date.now()}`;
    await db.insert(documents).values([
      {
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        folderId: ctx.folderId,
        title: 'Low Confidence Report',
        slug: suffixLow,
        path: `pricing/${suffixLow}`,
        content: 'quarterly revenue report analysis for finance team',
        status: 'active',
        type: 'fact',
        topics: [],
        confidenceLevel: 'low',
      },
      {
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        folderId: ctx.folderId,
        title: 'Medium Confidence Report',
        slug: suffixMed,
        path: `pricing/${suffixMed}`,
        content: 'quarterly revenue report analysis for finance team',
        status: 'active',
        type: 'fact',
        topics: [],
        confidenceLevel: 'medium',
      },
      {
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        folderId: ctx.folderId,
        title: 'High Confidence Report',
        slug: suffixHigh,
        path: `pricing/${suffixHigh}`,
        content: 'quarterly revenue report analysis for finance team',
        status: 'active',
        type: 'fact',
        topics: [],
        confidenceLevel: 'high',
      },
    ]);

    try {
      const toolCtx = {
        actor: { type: 'agent_token' as const, id: 'test-token-id', scopes: ['read'] as ['read'] },
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        grantedCapabilities: [] as [],
        webCallsThisTurn: 0,
      };

      const res = await searchDocumentsTool.call(
        { query: 'quarterly revenue report finance', confidence_min: 'medium' },
        toolCtx,
      );

      expect(res.success).toBe(true);
      if (!res.success) return;
      // No low-confidence result should appear.
      for (const r of res.data!.results) {
        expect(r.confidence).not.toBe('low');
      }
      // At least medium or high should appear.
      expect(res.data!.results.length).toBeGreaterThan(0);
    } finally {
      await db.delete(documents).where(eq(documents.slug, suffixLow));
      await db.delete(documents).where(eq(documents.slug, suffixMed));
      await db.delete(documents).where(eq(documents.slug, suffixHigh));
    }
  });
});

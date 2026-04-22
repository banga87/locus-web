import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { searchDocumentsTool } from '../search-documents';
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
    expect(res.data.results.length).toBeGreaterThan(0);
    const hit = res.data.results[0];
    expect(hit.provenance).toBeDefined();
    expect(hit.provenance.brainId).toBe(ctx.brainId);
    expect(hit.provenance.confidenceTier).toBe('extracted');
  });
});

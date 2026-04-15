// search_documents tests — exercise the full executor pipeline (ajv
// validation + permission gate + audit fan-out) against live Supabase
// so we catch tsvector / trigger / RLS-adjacent regressions.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

import { logEvent } from '@/lib/audit/logger';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';

import { executeTool, __resetRegistryForTests } from '../executor';
import {
  registerLocusTools,
  __resetLocusToolsRegistered,
} from '..';

import { setupFixtures, teardownFixtures, type Fixtures } from './_fixtures';

let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await setupFixtures('search');

  // Seed documents across two folders. Each doc sets status='active' so
  // the `status != 'archived'` filter does not exclude them.
  await db.insert(documents).values([
    {
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      title: 'Brand Voice Guide',
      slug: `brand-voice-${fixtures.suffix}`,
      path: `brand/brand-voice-${fixtures.suffix}`,
      content:
        'Our brand voice is plain and direct. We avoid jargon and speak to the reader like a peer.',
      status: 'active',
    },
    {
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderPricingId,
      title: 'Pricing Playbook',
      slug: `pricing-playbook-${fixtures.suffix}`,
      path: `pricing/pricing-playbook-${fixtures.suffix}`,
      content:
        'Pricing is tiered: starter, pro, business. We publish list prices and negotiate only on annual commit.',
      status: 'active',
    },
    {
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      title: 'Archived Brand Notes',
      slug: `archived-brand-${fixtures.suffix}`,
      path: `brand/archived-brand-${fixtures.suffix}`,
      content: 'Old brand voice notes about jargon avoidance.',
      status: 'archived',
    },
  ]);

  registerLocusTools();
});

afterAll(async () => {
  __resetRegistryForTests();
  __resetLocusToolsRegistered();
  await teardownFixtures(fixtures);
});

beforeEach(() => {
  vi.mocked(logEvent).mockClear();
});

describe('search_documents', () => {
  it('returns ranked results for a term that matches', async () => {
    const result = await executeTool(
      'search_documents',
      { query: 'brand voice' },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      query: string;
      results: Array<{ path: string; title: string; snippet: string }>;
    };
    expect(data.query).toBe('brand voice');
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    // Archived doc must NOT appear.
    expect(
      data.results.find((r) => r.path.startsWith('brand/archived-brand-')),
    ).toBeUndefined();
    // The active brand-voice doc should be the top (or near-top) hit.
    expect(data.results[0].path).toMatch(/^brand\/brand-voice-/);
    expect(data.results[0].snippet.length).toBeGreaterThan(0);
  });

  it('filters by folder slug', async () => {
    const result = await executeTool(
      'search_documents',
      { query: 'pricing', folder: 'pricing' },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      results: Array<{ path: string; folder: string | null }>;
    };
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    for (const row of data.results) {
      expect(row.folder).toBe('pricing');
    }
  });

  it('respects max_results', async () => {
    const result = await executeTool(
      'search_documents',
      { query: 'brand OR pricing OR jargon', max_results: 1 },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as { results: unknown[] };
    expect(data.results.length).toBeLessThanOrEqual(1);
  });

  it('fires a document_access audit entry with search-specific details', async () => {
    await executeTool(
      'search_documents',
      { query: 'pricing' },
      fixtures.context,
    );

    expect(logEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(logEvent).mock.calls[0]?.[0];
    expect(event?.category).toBe('document_access');
    expect(event?.eventType).toBe('tool.search_documents');
    expect(event?.targetType).toBe('brain');
    expect(event?.targetId).toBe(fixtures.brainId);
    expect(event?.details).toMatchObject({
      tool: 'search_documents',
      eventType: 'document.search',
      query: 'pricing',
    });
  });

  it('rejects missing query via ajv (invalid_input)', async () => {
    const result = await executeTool(
      'search_documents',
      {},
      fixtures.context,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('invalid_input');
  });
});

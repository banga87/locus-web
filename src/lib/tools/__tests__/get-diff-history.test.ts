// get_diff_history tests — full executor pipeline against live Supabase.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

import { logEvent } from '@/lib/audit/logger';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { documentVersions } from '@/db/schema/document-versions';

import { executeTool, __resetRegistryForTests } from '../executor';
import {
  registerLocusTools,
  __resetLocusToolsRegistered,
} from '..';

import { setupFixtures, teardownFixtures, type Fixtures } from './_fixtures';

let fixtures: Fixtures;
let brandDocId: string;
let pricingDocId: string;

// Fixed timestamps so the `since` window is deterministic.
const BOUNDARY = new Date('2026-01-01T00:00:00.000Z');
const AFTER = new Date('2026-02-01T00:00:00.000Z');
const BEFORE = new Date('2025-06-01T00:00:00.000Z');

beforeAll(async () => {
  fixtures = await setupFixtures('diffhist');

  // Brand doc updated after the boundary.
  const [brandDoc] = await db
    .insert(documents)
    .values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      title: 'Brand Doc',
      slug: `brand-${fixtures.suffix}`,
      path: `brand/brand-${fixtures.suffix}`,
      content:
        'Brand voice refresh — we now prefer concise headlines and plain body copy.',
      status: 'active',
      createdAt: BEFORE,
      updatedAt: AFTER,
    })
    .returning({ id: documents.id });
  brandDocId = brandDoc.id;

  await db.insert(documentVersions).values({
    companyId: fixtures.companyId,
    documentId: brandDocId,
    versionNumber: 2,
    content: 'Brand voice refresh content',
    changeSummary: 'rewrote tone guidance',
    changedBy: fixtures.ownerUserId,
    changedByType: 'human',
    createdAt: AFTER,
  });

  // Pricing doc updated after the boundary.
  const [pricingDoc] = await db
    .insert(documents)
    .values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderPricingId,
      title: 'Pricing Doc',
      slug: `pricing-${fixtures.suffix}`,
      path: `pricing/pricing-${fixtures.suffix}`,
      content: 'Starter $0, Pro $49, Business $199.',
      status: 'active',
      createdAt: BEFORE,
      updatedAt: AFTER,
    })
    .returning({ id: documents.id });
  pricingDocId = pricingDoc.id;

  await db.insert(documentVersions).values({
    companyId: fixtures.companyId,
    documentId: pricingDocId,
    versionNumber: 1,
    content: 'Pricing first draft',
    changeSummary: 'initial draft',
    changedBy: fixtures.ownerUserId,
    changedByType: 'human',
    createdAt: AFTER,
  });

  // Stale doc with updatedAt BEFORE the boundary. Should never surface.
  await db.insert(documents).values({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    folderId: fixtures.folderBrandId,
    title: 'Stale Doc',
    slug: `stale-${fixtures.suffix}`,
    path: `brand/stale-${fixtures.suffix}`,
    content: 'Old content',
    status: 'active',
    createdAt: BEFORE,
    updatedAt: BEFORE,
  });

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

describe('get_diff_history', () => {
  it('returns docs updated after the boundary', async () => {
    const result = await executeTool(
      'get_diff_history',
      { since: BOUNDARY.toISOString() },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      since: string;
      changes: Array<{ path: string; summary: string | null; preview?: string }>;
    };

    // Brand + pricing, never the stale doc.
    expect(data.changes.length).toBeGreaterThanOrEqual(2);
    const paths = data.changes.map((c) => c.path);
    expect(paths).toContain(`brand/brand-${fixtures.suffix}`);
    expect(paths).toContain(`pricing/pricing-${fixtures.suffix}`);
    expect(paths).not.toContain(`brand/stale-${fixtures.suffix}`);

    // Summary from latest version surfaced.
    const brandEntry = data.changes.find(
      (c) => c.path === `brand/brand-${fixtures.suffix}`,
    );
    expect(brandEntry?.summary).toBe('rewrote tone guidance');

    // No preview when the flag isn't set.
    expect(brandEntry?.preview).toBeUndefined();
  });

  it('filters by folder slug', async () => {
    const result = await executeTool(
      'get_diff_history',
      { since: BOUNDARY.toISOString(), folder: 'pricing' },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as { changes: Array<{ path: string }> };
    expect(data.changes.length).toBeGreaterThanOrEqual(1);
    for (const c of data.changes) {
      expect(c.path.startsWith('pricing/')).toBe(true);
    }
  });

  it('returns an empty array for a future `since`', async () => {
    const future = '2099-01-01T00:00:00.000Z';
    const result = await executeTool(
      'get_diff_history',
      { since: future },
      fixtures.context,
    );
    expect(result.success).toBe(true);
    const data = result.data as { changes: unknown[] };
    expect(data.changes).toEqual([]);
  });

  it('includes preview text when include_content_preview=true', async () => {
    const result = await executeTool(
      'get_diff_history',
      {
        since: BOUNDARY.toISOString(),
        include_content_preview: true,
      },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      changes: Array<{ path: string; preview?: string }>;
    };
    const brandEntry = data.changes.find(
      (c) => c.path === `brand/brand-${fixtures.suffix}`,
    );
    expect(brandEntry?.preview).toBeDefined();
    expect(brandEntry?.preview?.length ?? 0).toBeGreaterThan(0);
    expect(brandEntry?.preview?.length ?? 0).toBeLessThanOrEqual(200);
    expect(brandEntry?.preview).toContain('Brand voice refresh');
  });

  it('fires an audit entry for document.diff_history', async () => {
    await executeTool(
      'get_diff_history',
      { since: BOUNDARY.toISOString() },
      fixtures.context,
    );
    // Executor fans out per-doc events; calls[0] is the tool-level one.
    expect(logEvent).toHaveBeenCalled();
    const event = vi.mocked(logEvent).mock.calls[0]?.[0];
    expect(event?.eventType).toBe('tool.get_diff_history');
    expect(event?.targetType).toBe('brain');
    expect(event?.details).toMatchObject({
      tool: 'get_diff_history',
      eventType: 'document.diff_history',
    });
  });
});

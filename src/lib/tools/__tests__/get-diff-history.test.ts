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

  // Three docs sharing the exact same updatedAt, all after the boundary.
  // Pagination must still be deterministic via the id tiebreaker.
  const TIED = new Date('2026-03-15T12:00:00.000Z');
  for (let i = 0; i < 3; i++) {
    await db.insert(documents).values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      title: `Tied Doc ${i}`,
      slug: `tied-${i}-${fixtures.suffix}`,
      path: `brand/tied-${i}-${fixtures.suffix}`,
      content: `Tied doc ${i}`,
      status: 'active',
      createdAt: BEFORE,
      updatedAt: TIED,
    });
  }

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

  it('paginates newest-first with a stable cursor across two pages', async () => {
    const page1 = await executeTool(
      'get_diff_history',
      { since: BOUNDARY.toISOString(), limit: 1 },
      fixtures.context,
    );
    expect(page1.success).toBe(true);
    const p1 = page1.data as {
      changes: Array<{ path: string }>;
      next_cursor: string | null;
    };
    expect(p1.changes.length).toBe(1);
    expect(p1.next_cursor).toBeTruthy();

    const page2 = await executeTool(
      'get_diff_history',
      { since: BOUNDARY.toISOString(), limit: 1, cursor: p1.next_cursor },
      fixtures.context,
    );
    expect(page2.success).toBe(true);
    const p2 = page2.data as {
      changes: Array<{ path: string }>;
      next_cursor: string | null;
    };
    expect(p2.changes.length).toBe(1);
    const combined = [...p1.changes.map((c) => c.path), ...p2.changes.map((c) => c.path)];
    // Paginate all the way and verify brand+pricing both surface with no duplicates.
    const allPaths: string[] = [...combined];
    let cur: string | null = page2.data
      ? (page2.data as { next_cursor: string | null }).next_cursor
      : null;
    while (cur) {
      const next = await executeTool(
        'get_diff_history',
        { since: BOUNDARY.toISOString(), limit: 1, cursor: cur },
        fixtures.context,
      );
      expect(next.success).toBe(true);
      const d = next.data as {
        changes: Array<{ path: string }>;
        next_cursor: string | null;
      };
      for (const c of d.changes) allPaths.push(c.path);
      cur = d.next_cursor;
    }
    expect(allPaths).toContain(`brand/brand-${fixtures.suffix}`);
    expect(allPaths).toContain(`pricing/pricing-${fixtures.suffix}`);
    expect(new Set(combined).size).toBe(combined.length); // no duplicates across the first two pages
    expect(new Set(allPaths).size).toBe(allPaths.length); // no duplicates overall
  });

  it('returns next_cursor=null on the final page', async () => {
    // limit comfortably exceeds the number of rows in the window.
    const result = await executeTool(
      'get_diff_history',
      { since: BOUNDARY.toISOString(), limit: 500 },
      fixtures.context,
    );
    expect(result.success).toBe(true);
    const data = result.data as { changes: unknown[]; next_cursor: string | null };
    expect(data.next_cursor).toBeNull();
  });

  it('rejects limit outside [1, 500] with invalid_input', async () => {
    for (const badLimit of [0, 501, -1, 10000]) {
      const result = await executeTool(
        'get_diff_history',
        { since: BOUNDARY.toISOString(), limit: badLimit },
        fixtures.context,
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('invalid_input');
    }
  });

  it('rejects malformed cursor with invalid_input', async () => {
    const cases = [
      'not-base64!!',                                        // invalid base64
      Buffer.from('{"not":"a cursor"}').toString('base64'), // missing t/id
      Buffer.from('{"t":"nope","id":"also-not-uuid"}').toString('base64'),
      // Non-ISO timestamp with a valid UUID — must reject on timestamp alone.
      Buffer.from(
        JSON.stringify({ t: 'March 15 2026', id: '00000000-0000-0000-0000-000000000001' }),
        'utf8',
      ).toString('base64'),
    ];
    for (const cursor of cases) {
      const result = await executeTool(
        'get_diff_history',
        { since: BOUNDARY.toISOString(), cursor },
        fixtures.context,
      );
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('invalid_input');
      expect(result.error?.hint).toContain('next_cursor');
    }
  });

  it('returns empty changes and null next_cursor when cursor.t <= since (stale-cursor no-op)', async () => {
    // Cursor from before the since boundary — keyset predicate + since
    // AND naturally produce an empty page. No error.
    const staleCursor = Buffer.from(
      JSON.stringify({
        t: '2025-01-01T00:00:00.000Z',
        id: '00000000-0000-0000-0000-000000000000',
      }),
      'utf8',
    ).toString('base64');

    const result = await executeTool(
      'get_diff_history',
      { since: BOUNDARY.toISOString(), cursor: staleCursor },
      fixtures.context,
    );
    expect(result.success).toBe(true);
    const data = result.data as { changes: unknown[]; next_cursor: string | null };
    expect(data.changes).toEqual([]);
    expect(data.next_cursor).toBeNull();
  });

  it('handles ties across the whole window via id tiebreaker — no duplicates, no skips', async () => {
    // Narrow `since` so only the three tied docs surface.
    const sinceIso = '2026-03-01T00:00:00.000Z';

    const page1 = await executeTool(
      'get_diff_history',
      { since: sinceIso, limit: 1 },
      fixtures.context,
    );
    const p1 = page1.data as { changes: Array<{ path: string }>; next_cursor: string | null };
    expect(p1.changes.length).toBe(1);
    expect(p1.next_cursor).toBeTruthy();

    const page2 = await executeTool(
      'get_diff_history',
      { since: sinceIso, limit: 1, cursor: p1.next_cursor },
      fixtures.context,
    );
    const p2 = page2.data as { changes: Array<{ path: string }>; next_cursor: string | null };
    expect(p2.changes.length).toBe(1);

    const page3 = await executeTool(
      'get_diff_history',
      { since: sinceIso, limit: 1, cursor: p2.next_cursor },
      fixtures.context,
    );
    const p3 = page3.data as { changes: Array<{ path: string }>; next_cursor: string | null };
    expect(p3.changes.length).toBe(1);
    expect(p3.next_cursor).toBeNull();

    const combined = [...p1.changes, ...p2.changes, ...p3.changes].map((c) => c.path);
    expect(new Set(combined).size).toBe(3); // all three tied docs, no dupes
    for (const p of combined) {
      expect(p.startsWith(`brand/tied-`)).toBe(true);
    }
  });
});

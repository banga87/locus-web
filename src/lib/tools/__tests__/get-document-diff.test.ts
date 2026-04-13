// get_document_diff tests — full executor pipeline against live Supabase.

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
let versionedDocId: string;
let bareDocId: string;

beforeAll(async () => {
  fixtures = await setupFixtures('diff');

  const [versionedDoc] = await db
    .insert(documents)
    .values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      categoryId: fixtures.categoryBrandId,
      title: 'Versioned Doc',
      slug: `versioned-${fixtures.suffix}`,
      path: `brand/versioned-${fixtures.suffix}`,
      content: 'v3 content',
      status: 'active',
      version: 3,
    })
    .returning({ id: documents.id });
  versionedDocId = versionedDoc.id;

  // Three versions, newest last so desc(createdAt) orders correctly.
  // Use explicit createdAt so ordering is deterministic even when writes
  // happen within the same millisecond.
  const baseTime = Date.now();
  await db.insert(documentVersions).values([
    {
      companyId: fixtures.companyId,
      documentId: versionedDocId,
      versionNumber: 1,
      content: 'v1 content',
      changeSummary: 'initial draft',
      changedBy: fixtures.ownerUserId,
      changedByType: 'human',
      createdAt: new Date(baseTime - 60_000),
    },
    {
      companyId: fixtures.companyId,
      documentId: versionedDocId,
      versionNumber: 2,
      content: 'v2 content',
      changeSummary: 'tightened language',
      changedBy: fixtures.ownerUserId,
      changedByType: 'human',
      createdAt: new Date(baseTime - 30_000),
    },
    {
      companyId: fixtures.companyId,
      documentId: versionedDocId,
      versionNumber: 3,
      content: 'v3 content',
      changeSummary: 'added pricing note',
      changedBy: fixtures.ownerUserId,
      changedByType: 'human',
      createdAt: new Date(baseTime),
    },
  ]);

  const [bareDoc] = await db
    .insert(documents)
    .values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      title: 'Bare Doc',
      slug: `bare-${fixtures.suffix}`,
      path: `brand/bare-${fixtures.suffix}`,
      content: 'no history yet',
      status: 'active',
    })
    .returning({ id: documents.id });
  bareDocId = bareDoc.id;

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

describe('get_document_diff', () => {
  it('returns recent versions newest-first', async () => {
    const result = await executeTool(
      'get_document_diff',
      { document_id: versionedDocId },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      document_id: string;
      document_path: string;
      changes: Array<{
        version: number;
        change_type: string;
        changed_at: string;
        summary: string | null;
        changed_by: string;
      }>;
    };
    expect(data.document_id).toBe(versionedDocId);
    expect(data.document_path).toBe(`brand/versioned-${fixtures.suffix}`);
    expect(data.changes).toHaveLength(3);
    expect(data.changes[0].version).toBe(3);
    expect(data.changes[0].summary).toBe('added pricing note');
    expect(data.changes[0].change_type).toBe('updated');
    expect(data.changes[2].version).toBe(1);
    expect(data.changes[2].change_type).toBe('created');
  });

  it('respects limit', async () => {
    const result = await executeTool(
      'get_document_diff',
      { document_id: versionedDocId, limit: 1 },
      fixtures.context,
    );
    expect(result.success).toBe(true);
    const data = result.data as { changes: unknown[] };
    expect(data.changes).toHaveLength(1);
  });

  it('returns an empty changes array when no versions exist', async () => {
    const result = await executeTool(
      'get_document_diff',
      { document_id: bareDocId },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as { changes: unknown[] };
    expect(data.changes).toEqual([]);
  });

  it('fires an audit entry for document.diff', async () => {
    await executeTool(
      'get_document_diff',
      { document_id: versionedDocId },
      fixtures.context,
    );
    expect(logEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(logEvent).mock.calls[0]?.[0];
    expect(event?.eventType).toBe('tool.get_document_diff');
    expect(event?.details).toMatchObject({
      tool: 'get_document_diff',
      eventType: 'document.diff',
    });
  });

  it('returns document_not_found for an unknown id', async () => {
    const result = await executeTool(
      'get_document_diff',
      { document_id: '00000000-0000-0000-0000-000000000000' },
      fixtures.context,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('document_not_found');
  });
});

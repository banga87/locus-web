// get_document tests — full executor pipeline against live Supabase.

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
let docId: string;
let sectionedDocId: string;

const MAIN_PATH_BASE = 'brand/brand-voice';
const SECTIONED_PATH_BASE = 'brand/sectioned';
const HUGE_PATH_BASE = 'brand/huge';

beforeAll(async () => {
  fixtures = await setupFixtures('getdoc');

  const [mainDoc] = await db
    .insert(documents)
    .values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      ownerId: fixtures.ownerUserId,
      title: 'Brand Voice Guide',
      slug: `brand-voice-${fixtures.suffix}`,
      path: `${MAIN_PATH_BASE}-${fixtures.suffix}`,
      content: '# Brand Voice\n\nWe speak plainly and directly.',
      status: 'active',
      confidenceLevel: 'high',
      isCore: true,
      version: 3,
    })
    .returning({ id: documents.id });
  docId = mainDoc.id;

  const [sectionedDoc] = await db
    .insert(documents)
    .values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      title: 'Multi-Section Doc',
      slug: `sectioned-${fixtures.suffix}`,
      path: `${SECTIONED_PATH_BASE}-${fixtures.suffix}`,
      content:
        '## Overview\n\nTop level intro.\n\n' +
        '## Pricing\n\nStarter $0. Pro $49. Business $199.\n\n' +
        '## Support\n\nEmail support only.',
      status: 'active',
    })
    .returning({ id: documents.id });
  sectionedDocId = sectionedDoc.id;

  // Doc well over 32000 chars (≈ 8000 tokens).
  const filler = 'abcdefgh '.repeat(6000); // ~54000 chars
  await db.insert(documents).values({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    title: 'Huge Doc',
    slug: `huge-${fixtures.suffix}`,
    path: `${HUGE_PATH_BASE}-${fixtures.suffix}`,
    content: filler,
    status: 'active',
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

describe('get_document', () => {
  it('returns content with YAML frontmatter prefix by default', async () => {
    const result = await executeTool(
      'get_document',
      { path: `${MAIN_PATH_BASE}-${fixtures.suffix}` },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      document: { content: string; id: string; path: string; title: string };
    };
    const content = data.document.content;
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toMatch(/status: active/);
    expect(content).toMatch(/confidence_level: high/);
    expect(content).toMatch(/is_core: true/);
    expect(content).toMatch(new RegExp(`owner: "${fixtures.ownerEmail}"`));
    expect(content).toMatch(/version: 3/);
    expect(content).toMatch(/updated_at: \d{4}-\d{2}-\d{2}T/);
    // Body still present after closing marker.
    expect(content).toContain('We speak plainly');
    expect(data.document.id).toBe(docId);
  });

  it('omits frontmatter when include_metadata=false', async () => {
    const result = await executeTool(
      'get_document',
      {
        path: `${MAIN_PATH_BASE}-${fixtures.suffix}`,
        include_metadata: false,
      },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as { document: { content: string } };
    expect(data.document.content.startsWith('---')).toBe(false);
    expect(data.document.content).toContain('We speak plainly');
  });

  it('slices to a single H2 section when `section` is supplied', async () => {
    const result = await executeTool(
      'get_document',
      {
        path: `${SECTIONED_PATH_BASE}-${fixtures.suffix}`,
        section: 'Pricing',
        include_metadata: false,
      },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as { document: { content: string } };
    expect(data.document.content).toContain('## Pricing');
    expect(data.document.content).toContain('Starter $0');
    // Support section should NOT leak in — ## headings delimit sections.
    expect(data.document.content).not.toContain('Email support');
    // Overview preceded it but must also not leak.
    expect(data.document.content).not.toContain('Top level intro');
  });

  it('returns document_not_found with suggestions for a typo path', async () => {
    const typo = `${MAIN_PATH_BASE}-${fixtures.suffix}-xx`;
    const result = await executeTool(
      'get_document',
      { path: typo },
      fixtures.context,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('document_not_found');
    expect(Array.isArray(result.error?.suggestions)).toBe(true);
    expect(result.error?.suggestions?.length).toBeGreaterThan(0);
    // The closest real path should be the top suggestion.
    expect(result.error?.suggestions?.[0]).toBe(
      `${MAIN_PATH_BASE}-${fixtures.suffix}`,
    );
  });

  it('truncates when serialized body exceeds ~8000 tokens', async () => {
    const result = await executeTool(
      'get_document',
      { path: `${HUGE_PATH_BASE}-${fixtures.suffix}` },
      fixtures.context,
    );

    expect(result.success).toBe(true);
    const data = result.data as { document: { content: string } };
    expect(data.document.content).toContain(
      '<!-- response truncated at 8000 tokens -->',
    );
    // Truncated content must be shorter than the original (54k chars).
    expect(data.document.content.length).toBeLessThan(54000);
    // Ceil check: length / 4 should be at or under 8000 + marker.
    expect(Math.ceil(data.document.content.length / 4)).toBeLessThanOrEqual(
      8001,
    );
  });

  it('fires a document_access audit entry tagged with the document id', async () => {
    await executeTool(
      'get_document',
      { path: `${MAIN_PATH_BASE}-${fixtures.suffix}` },
      fixtures.context,
    );
    // Executor fires a tool-level event (targetType=brain) plus one
    // per-doc event per documentsAccessed entry — don't pin the count.
    expect(logEvent).toHaveBeenCalled();
    const event = vi.mocked(logEvent).mock.calls[0]?.[0];
    expect(event?.category).toBe('document_access');
    expect(event?.eventType).toBe('tool.get_document');
    expect(event?.targetType).toBe('brain');
    expect(event?.details).toMatchObject({
      tool: 'get_document',
      eventType: 'document.read',
      truncated: false,
    });
    expect(event?.details?.documentsAccessed).toContain(docId);
  });

  it('rejects when neither path nor id is supplied', async () => {
    const result = await executeTool('get_document', {}, fixtures.context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('invalid_input');
  });

  it('also works by id', async () => {
    const result = await executeTool(
      'get_document',
      { id: sectionedDocId, include_metadata: false },
      fixtures.context,
    );
    expect(result.success).toBe(true);
    const data = result.data as { document: { content: string; id: string } };
    expect(data.document.id).toBe(sectionedDocId);
    expect(data.document.content).toContain('## Overview');
  });
});

// update_document tests — full executor pipeline against live Supabase.
//
// Pattern mirrors create-document.test.ts: setupFixtures creates the
// DB state; we test tool.call() for tool-level behaviour and executeTool()
// for pipeline integration (permission gates).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: vi.fn(async () => {}),
}));

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { documentVersions } from '@/db/schema/document-versions';
import { and, eq, isNull } from 'drizzle-orm';

import { executeTool, __resetRegistryForTests } from '../executor';
import { registerLocusTools, __resetLocusToolsRegistered } from '..';
import { updateDocumentTool } from '../implementations/update-document';
import { setupFixtures, teardownFixtures, type Fixtures } from './_fixtures';
import type { ToolContext } from '../types';

let fixtures: Fixtures;
/** ID of a pre-created document all update tests can target. */
let targetDocId: string;
let targetDocPath: string;

function makeWriteCtx(f: Fixtures): ToolContext {
  return {
    ...f.context,
    actor: {
      ...f.context.actor,
      scopes: ['read', 'write'],
      role: 'editor',
    },
  };
}

beforeAll(async () => {
  fixtures = await setupFixtures('updatedoc');

  // Pre-create a document that the update tests target.
  targetDocPath = `brand/update-target-${fixtures.suffix}`;
  const [doc] = await db
    .insert(documents)
    .values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      title: 'Update Target',
      slug: `update-target-${fixtures.suffix}`,
      path: targetDocPath,
      content: '# Original\n\nOriginal content.',
      status: 'draft',
      confidenceLevel: 'medium',
      version: 1,
    })
    .returning({ id: documents.id });
  targetDocId = doc.id;

  // Seed an initial version row.
  await db.insert(documentVersions).values({
    companyId: fixtures.companyId,
    documentId: targetDocId,
    versionNumber: 1,
    content: '# Original\n\nOriginal content.',
    changeSummary: 'created',
    changedBy: fixtures.ownerUserId,
    changedByType: 'human',
    metadataSnapshot: { title: 'Update Target', status: 'draft', confidenceLevel: 'medium' },
  });

  registerLocusTools();
});

afterAll(async () => {
  __resetRegistryForTests();
  __resetLocusToolsRegistered();
  await teardownFixtures(fixtures);
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('updateDocumentTool.call — input validation', () => {
  it('rejects when neither path nor documentId is supplied', async () => {
    const result = await updateDocumentTool.call(
      { title: 'New Title' } as never,
      makeWriteCtx(fixtures),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects when both path and documentId are supplied', async () => {
    const result = await updateDocumentTool.call(
      { path: targetDocPath, documentId: targetDocId, title: 'T' },
      makeWriteCtx(fixtures),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(result.error?.message).toContain('not both');
  });

  it('rejects when an identifier is supplied but no editable fields', async () => {
    const result = await updateDocumentTool.call(
      { path: targetDocPath } as never,
      makeWriteCtx(fixtures),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(result.error?.message).toContain('At least one editable field');
  });

  it('returns DOCUMENT_NOT_FOUND for a nonexistent path', async () => {
    const result = await updateDocumentTool.call(
      { path: 'brand/does-not-exist-9999', title: 'X' },
      makeWriteCtx(fixtures),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('returns DOCUMENT_NOT_FOUND for a nonexistent documentId', async () => {
    const result = await updateDocumentTool.call(
      {
        documentId: '00000000-0000-0000-0000-000000000000',
        title: 'Ghost',
      },
      makeWriteCtx(fixtures),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DOCUMENT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Success paths
// ---------------------------------------------------------------------------

describe('updateDocumentTool.call — success path', () => {
  it('updates title and increments version', async () => {
    const result = await updateDocumentTool.call(
      { path: targetDocPath, title: 'Updated Title' },
      makeWriteCtx(fixtures),
    );

    expect(result.success).toBe(true);
    expect(result.data?.title).toBe('Updated Title');
    expect(result.data?.version).toBe(2);
    expect(result.data?.path).toBe(targetDocPath);
    expect(result.data?.documentId).toBe(targetDocId);
  });

  it('preserves unchanged fields when only title is updated', async () => {
    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, targetDocId))
      .limit(1);

    // Content and status should be unchanged from the original (only title was patched).
    expect(row.content).toBe('# Original\n\nOriginal content.');
    expect(row.status).toBe('draft');
    expect(row.confidenceLevel).toBe('medium');
  });

  it('updates body and writes a new document_versions row', async () => {
    const newBody = '# Revised\n\nRevised content for versioning test.';

    const result = await updateDocumentTool.call(
      { path: targetDocPath, body: newBody },
      makeWriteCtx(fixtures),
    );

    expect(result.success).toBe(true);
    const currentVersion = result.data!.version;

    // Fetch the version row that was just written.
    const [vrow] = await db
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, targetDocId),
          eq(documentVersions.versionNumber, currentVersion),
        ),
      )
      .limit(1);

    expect(vrow).toBeDefined();
    expect(vrow.content).toBe(newBody);
    expect(vrow.changedByType).toBe('agent');
    expect(vrow.changeSummary).toContain('body');
  });

  it('can update status and confidenceLevel together', async () => {
    const result = await updateDocumentTool.call(
      {
        path: targetDocPath,
        status: 'active',
        confidenceLevel: 'high',
      },
      makeWriteCtx(fixtures),
    );

    expect(result.success).toBe(true);

    const [row] = await db
      .select({ status: documents.status, confidenceLevel: documents.confidenceLevel })
      .from(documents)
      .where(eq(documents.id, targetDocId))
      .limit(1);

    expect(row.status).toBe('active');
    expect(row.confidenceLevel).toBe('high');
  });

  it('also works by documentId (UUID lookup)', async () => {
    const result = await updateDocumentTool.call(
      { documentId: targetDocId, summary: 'A fresh summary.' },
      makeWriteCtx(fixtures),
    );

    expect(result.success).toBe(true);
    expect(result.data?.documentId).toBe(targetDocId);

    const [row] = await db
      .select({ summary: documents.summary })
      .from(documents)
      .where(eq(documents.id, targetDocId))
      .limit(1);

    expect(row.summary).toBe('A fresh summary.');
  });

  it('does not touch a document outside the caller\'s brain', async () => {
    // A document with targetDocId but a different brainId should not be found.
    const wrongBrainCtx: ToolContext = {
      ...makeWriteCtx(fixtures),
      brainId: '00000000-0000-0000-0000-000000000000',
    };

    const result = await updateDocumentTool.call(
      { documentId: targetDocId, title: 'Cross-brain Attempt' },
      wrongBrainCtx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DOCUMENT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Executor-level tests (permission gate in the pipeline)
// ---------------------------------------------------------------------------

describe('update_document via executeTool — permission gate', () => {
  it('denies a viewer (role gate blocks write)', async () => {
    const viewerCtx: ToolContext = {
      ...fixtures.context,
      actor: {
        ...fixtures.context.actor,
        scopes: ['read', 'write'],
        role: 'viewer',
      },
    };

    const result = await executeTool(
      'update_document',
      { path: targetDocPath, title: 'Viewer Attempt' },
      viewerCtx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('permission_denied');
  });

  it('allows an owner to update a document', async () => {
    // Create a fresh doc for this test to avoid version conflicts.
    const freshPath = `brand/owner-update-${fixtures.suffix}`;
    await db.insert(documents).values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      title: 'Owner Update Test',
      slug: `owner-update-${fixtures.suffix}`,
      path: freshPath,
      content: 'Original.',
      version: 1,
    });

    const ownerCtx: ToolContext = {
      ...fixtures.context,
      actor: {
        ...fixtures.context.actor,
        scopes: ['read', 'write'],
        role: 'owner',
      },
    };

    const result = await executeTool(
      'update_document',
      { path: freshPath, title: 'Owner Updated' },
      ownerCtx,
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ title: 'Owner Updated', version: 2 });
  });
});

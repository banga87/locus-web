// create_document tests — full executor pipeline against live Supabase.
//
// Pattern: setupFixtures creates a company/brain/folders/user; each test
// inserts or relies on the fixture, then teardownFixtures cleans up.
// The executor is used for pipeline tests (scope gate, permission gate);
// createDocumentTool.call is used directly where we want to test
// tool-level behaviour without the executor overhead.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

// Best-effort manifest regen — mock to avoid needing a real manifest table
// row; the tool already calls tryRegenerateManifest which swallows errors,
// but mocking makes tests faster and removes the log noise.
vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: vi.fn(async () => {}),
}));

import { logEvent } from '@/lib/audit/logger';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { documentVersions } from '@/db/schema/document-versions';
import { and, eq, isNull } from 'drizzle-orm';

import { executeTool, __resetRegistryForTests } from '../executor';
import { registerLocusTools, __resetLocusToolsRegistered } from '..';
import { createDocumentTool } from '../implementations/create-document';
import { setupFixtures, teardownFixtures, type Fixtures } from './_fixtures';
import type { ToolContext } from '../types';

let fixtures: Fixtures;

/** Context with write scope + editor role for tool.call() tests. */
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
  fixtures = await setupFixtures('createdoc');
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

// ---------------------------------------------------------------------------
// Tool-level tests (direct tool.call — bypasses executor gates by design)
// ---------------------------------------------------------------------------

describe('createDocumentTool.call — input validation', () => {
  it('rejects a path with no slash', async () => {
    const result = await createDocumentTool.call(
      { path: 'noslash', title: 'T', body: 'B' },
      makeWriteCtx(fixtures),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects a path with a leading slash only (no doc segment)', async () => {
    const result = await createDocumentTool.call(
      { path: 'brand/', title: 'T', body: 'B' },
      makeWriteCtx(fixtures),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects a path with uppercase letters', async () => {
    const result = await createDocumentTool.call(
      { path: 'Brand/voice', title: 'T', body: 'B' },
      makeWriteCtx(fixtures),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('returns FOLDER_NOT_FOUND when folder slug does not exist', async () => {
    const result = await createDocumentTool.call(
      { path: 'nonexistent-folder/my-doc', title: 'T', body: 'B' },
      makeWriteCtx(fixtures),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FOLDER_NOT_FOUND');
  });
});

describe('createDocumentTool.call — success path', () => {
  it('creates a document and returns documentId + path + version=1', async () => {
    const path = `brand/new-doc-${fixtures.suffix}`;
    const result = await createDocumentTool.call(
      { path, title: 'New Doc', body: 'Hello world' },
      makeWriteCtx(fixtures),
    );

    expect(result.success).toBe(true);
    expect(result.data?.documentId).toBeDefined();
    expect(result.data?.path).toBe(path);
    expect(result.data?.title).toBe('New Doc');
    expect(result.data?.version).toBe(1);
  });

  it('persists the document to the DB with correct fields', async () => {
    const path = `brand/db-check-${fixtures.suffix}`;
    const result = await createDocumentTool.call(
      {
        path,
        title: 'DB Check',
        body: '# Hello\n\nSome content.',
        status: 'active',
        confidenceLevel: 'high',
        summary: 'A summary.',
      },
      makeWriteCtx(fixtures),
    );

    expect(result.success).toBe(true);
    const docId = result.data!.documentId;

    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, docId), isNull(documents.deletedAt)))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.path).toBe(path);
    expect(row.title).toBe('DB Check');
    expect(row.content).toBe('# Hello\n\nSome content.');
    expect(row.status).toBe('active');
    expect(row.confidenceLevel).toBe('high');
    expect(row.summary).toBe('A summary.');
    expect(row.version).toBe(1);
    expect(row.brainId).toBe(fixtures.brainId);
    expect(row.companyId).toBe(fixtures.companyId);
  });

  it('writes an initial document_versions row (versionNumber=1, changeSummary contains "created")', async () => {
    const path = `brand/version-row-${fixtures.suffix}`;
    const result = await createDocumentTool.call(
      { path, title: 'Version Row Test', body: 'Body here.' },
      makeWriteCtx(fixtures),
    );

    expect(result.success).toBe(true);
    const docId = result.data!.documentId;

    const [vrow] = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, docId))
      .limit(1);

    expect(vrow).toBeDefined();
    expect(vrow.versionNumber).toBe(1);
    expect(vrow.changeSummary).toContain('created');
    expect(vrow.changedByType).toBe('agent');
    expect(vrow.content).toBe('Body here.');
  });

  it('returns PATH_TAKEN when a document with that path already exists', async () => {
    const path = `brand/duplicate-${fixtures.suffix}`;
    // First create succeeds.
    const first = await createDocumentTool.call(
      { path, title: 'First', body: 'Body' },
      makeWriteCtx(fixtures),
    );
    expect(first.success).toBe(true);

    // Second create at the same path must return PATH_TAKEN.
    const second = await createDocumentTool.call(
      { path, title: 'Second', body: 'Body 2' },
      makeWriteCtx(fixtures),
    );
    expect(second.success).toBe(false);
    expect(second.error?.code).toBe('PATH_TAKEN');
    expect(second.error?.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Executor-level tests (permission gate in the pipeline)
// ---------------------------------------------------------------------------

describe('create_document via executeTool — permission gate', () => {
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
      'create_document',
      {
        path: `brand/viewer-attempt-${fixtures.suffix}`,
        title: 'Viewer Attempt',
        body: 'Should be denied',
      },
      viewerCtx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('permission_denied');
  });

  it('denies a caller without write scope (scope gate)', async () => {
    const readOnlyCtx: ToolContext = {
      ...fixtures.context,
      actor: {
        ...fixtures.context.actor,
        scopes: ['read'], // no 'write'
        role: 'editor',
      },
    };

    const result = await executeTool(
      'create_document',
      {
        path: `brand/scope-attempt-${fixtures.suffix}`,
        title: 'Scope Attempt',
        body: 'Should be denied',
      },
      readOnlyCtx,
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('scope_denied');
  });

  it('allows an editor with write scope to create a document', async () => {
    const editorCtx: ToolContext = {
      ...fixtures.context,
      actor: {
        ...fixtures.context.actor,
        scopes: ['read', 'write'],
        role: 'editor',
      },
    };

    const result = await executeTool(
      'create_document',
      {
        path: `brand/editor-create-${fixtures.suffix}`,
        title: 'Editor Create',
        body: 'Editor-authored content.',
      },
      editorCtx,
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      path: `brand/editor-create-${fixtures.suffix}`,
      title: 'Editor Create',
      version: 1,
    });
  });
});

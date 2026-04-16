// stamp-middleware.ts tests.
//
// The stamp middleware wraps a buildToolSet-style Record<string, Tool> so that:
//   - create_document calls inject workflow provenance into documents.metadata
//     (created_by_workflow + created_by_workflow_run_id)
//   - update_document calls inject workflow provenance into documents.metadata
//     (last_touched_by_workflow + last_touched_by_workflow_run_id)
//   - Successful write tool calls append the documentId to
//     workflow_runs.output_document_ids (no duplicates)
//   - Non-write tools are passed through unchanged
//
// Integration tests against the real DB — we create actual documents and
// verify the metadata column contains the stamps.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: vi.fn(async () => {}),
}));

vi.mock('@/lib/brain/save', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/brain/save')>();
  return {
    ...original,
    maybeScheduleSkillManifestRebuild: vi.fn(),
  };
});

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';

import { executeTool, __resetRegistryForTests } from '@/lib/tools/executor';
import { registerLocusTools, __resetLocusToolsRegistered } from '@/lib/tools';
import { bridgeLocusTool } from '@/lib/agent/tool-bridge';
import { createDocumentTool } from '@/lib/tools/implementations/create-document';
import { updateDocumentTool } from '@/lib/tools/implementations/update-document';
import type { ToolContext } from '@/lib/tools/types';

import { wrapToolsWithStamping } from '../stamp-middleware';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface StampFixtures {
  companyId: string;
  brainId: string;
  folderId: string;
  userId: string;
  workflowDocId: string;
  runId: string;
  writeCtx: ToolContext;
}

async function setupStampFixtures(): Promise<StampFixtures> {
  const suffix = `stamp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Stamp Co ${suffix}`, slug: `stamp-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company!.id, name: 'Stamp Brain', slug: 'stamp' })
    .returning({ id: brains.id });

  const [folder] = await db
    .insert(folders)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      slug: 'docs',
      name: 'Docs',
    })
    .returning({ id: folders.id });

  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    companyId: company!.id,
    fullName: 'Stamp User',
    email: `stamp-${suffix}@example.test`,
    status: 'active',
  });

  // Minimal workflow doc
  const [wfDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: 'Stamp Workflow',
      slug: 'stamp-workflow',
      path: 'docs/stamp-workflow',
      content: '---\ntype: workflow\noutput: document\nrequires_mcps: []\n---\nDo things.',
      type: 'workflow',
      version: 1,
    })
    .returning({ id: documents.id });

  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowDocumentId: wfDoc!.id,
      triggeredBy: userId,
      status: 'running',
    })
    .returning({ id: workflowRuns.id });

  const writeCtx: ToolContext = {
    actor: {
      type: 'platform_agent',
      id: userId,
      scopes: ['read', 'write'],
      role: 'editor',
    },
    companyId: company!.id,
    brainId: brain!.id,
    grantedCapabilities: [],
    webCallsThisTurn: 0,
  };

  return {
    companyId: company!.id,
    brainId: brain!.id,
    folderId: folder!.id,
    userId,
    workflowDocId: wfDoc!.id,
    runId: run!.id,
    writeCtx,
  };
}

async function teardownStampFixtures(f: StampFixtures): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(workflowRuns).where(eq(workflowRuns.id, f.runId));
    await tx.delete(brains).where(eq(brains.id, f.brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(users).where(eq(users.id, f.userId));
  await db.delete(companies).where(eq(companies.id, f.companyId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let fix: StampFixtures;

beforeAll(async () => {
  fix = await setupStampFixtures();
  registerLocusTools();
});

afterAll(async () => {
  __resetRegistryForTests();
  __resetLocusToolsRegistered();
  await teardownStampFixtures(fix);
});

describe('wrapToolsWithStamping — create_document', () => {
  it('injects created_by_workflow stamps into document metadata', async () => {
    const workflowDocRef = 'docs/stamp-workflow';
    const baseTool = bridgeLocusTool(createDocumentTool, fix.writeCtx);
    const wrapped = wrapToolsWithStamping(
      { create_document: baseTool },
      { runId: fix.runId, workflowDocRef },
      fix.writeCtx,
    );

    // Call the wrapped tool directly (simulating AI SDK tool execution)
    const result = await wrapped['create_document']!.execute!(
      {
        path: 'docs/stamp-created-doc',
        title: 'Stamp Created Doc',
        body: 'Created by workflow.',
      },
      { messages: [], toolCallId: 'tc-1', abortSignal: new AbortController().signal },
    );

    // Tool should have succeeded
    expect(result).toBeDefined();
    expect((result as { error?: unknown }).error).toBeUndefined();

    // Verify the stamp is in document metadata
    const docId = (result as { documentId: string }).documentId;
    const [doc] = await db
      .select({ metadata: documents.metadata })
      .from(documents)
      .where(eq(documents.id, docId));

    const meta = doc!.metadata as Record<string, unknown>;
    expect(meta['created_by_workflow']).toBe(workflowDocRef);
    expect(meta['created_by_workflow_run_id']).toBe(fix.runId);
  });

  it('appends the created documentId to workflow_runs.output_document_ids', async () => {
    const baseTool = bridgeLocusTool(createDocumentTool, fix.writeCtx);
    const wrapped = wrapToolsWithStamping(
      { create_document: baseTool },
      { runId: fix.runId, workflowDocRef: 'docs/stamp-workflow' },
      fix.writeCtx,
    );

    const result = await wrapped['create_document']!.execute!(
      {
        path: 'docs/stamp-output-doc',
        title: 'Stamp Output Doc',
        body: 'Output.',
      },
      { messages: [], toolCallId: 'tc-2', abortSignal: new AbortController().signal },
    );

    const docId = (result as { documentId: string }).documentId;

    const [run] = await db
      .select({ outputDocumentIds: workflowRuns.outputDocumentIds })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, fix.runId));

    expect(run!.outputDocumentIds).toContain(docId);
  });

  it('does not duplicate documentId when called twice with the same doc', async () => {
    // This tests the no-duplicate invariant by calling the middleware append
    // logic directly — we simulate by calling create on a new doc then
    // verifying the array length increments by exactly 1.
    const [runBefore] = await db
      .select({ outputDocumentIds: workflowRuns.outputDocumentIds })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, fix.runId));
    const countBefore = runBefore!.outputDocumentIds.length;

    const baseTool = bridgeLocusTool(createDocumentTool, fix.writeCtx);
    const wrapped = wrapToolsWithStamping(
      { create_document: baseTool },
      { runId: fix.runId, workflowDocRef: 'docs/stamp-workflow' },
      fix.writeCtx,
    );

    const result = await wrapped['create_document']!.execute!(
      {
        path: 'docs/stamp-dedup-doc',
        title: 'Stamp Dedup Doc',
        body: 'Dedup test.',
      },
      { messages: [], toolCallId: 'tc-3', abortSignal: new AbortController().signal },
    );

    const docId = (result as { documentId: string }).documentId;

    // Simulate calling append again with the same docId (e.g. a retry)
    // by directly calling appendOutputDocumentId from stamp-middleware
    const { appendOutputDocumentId } = await import('../stamp-middleware');
    await appendOutputDocumentId(fix.runId, docId);

    const [runAfter] = await db
      .select({ outputDocumentIds: workflowRuns.outputDocumentIds })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, fix.runId));

    // Should be exactly +1 despite two append attempts
    expect(runAfter!.outputDocumentIds.length).toBe(countBefore + 1);
  });
});

describe('wrapToolsWithStamping — update_document', () => {
  it('injects last_touched_by_workflow stamps into document metadata', async () => {
    // First create a doc to update
    const [doc] = await db
      .insert(documents)
      .values({
        companyId: fix.companyId,
        brainId: fix.brainId,
        folderId: fix.folderId,
        title: 'Pre-existing Doc',
        slug: 'pre-existing-doc',
        path: 'docs/pre-existing-doc',
        content: 'Original content.',
        version: 1,
      })
      .returning({ id: documents.id });

    const workflowDocRef = 'docs/stamp-workflow';
    const baseTool = bridgeLocusTool(updateDocumentTool, fix.writeCtx);
    const wrapped = wrapToolsWithStamping(
      { update_document: baseTool },
      { runId: fix.runId, workflowDocRef },
      fix.writeCtx,
    );

    await wrapped['update_document']!.execute!(
      {
        documentId: doc!.id,
        body: 'Updated by workflow.',
      },
      { messages: [], toolCallId: 'tc-4', abortSignal: new AbortController().signal },
    );

    const [updated] = await db
      .select({ metadata: documents.metadata })
      .from(documents)
      .where(eq(documents.id, doc!.id));

    const meta = updated!.metadata as Record<string, unknown>;
    expect(meta['last_touched_by_workflow']).toBe(workflowDocRef);
    expect(meta['last_touched_by_workflow_run_id']).toBe(fix.runId);
    // Must NOT set create stamps on an update
    expect(meta['created_by_workflow']).toBeUndefined();
  });
});

describe('wrapToolsWithStamping — non-write tools', () => {
  it('passes non-write tools through without modification', async () => {
    const noopExecute = vi.fn(async () => ({ result: 'ok' }));
    const fakeReadTool = {
      description: 'read-only',
      inputSchema: { jsonSchema: { type: 'object' } },
      execute: noopExecute,
    } as unknown as import('ai').Tool;

    const wrapped = wrapToolsWithStamping(
      { some_read_tool: fakeReadTool },
      { runId: fix.runId, workflowDocRef: 'docs/stamp-workflow' },
      fix.writeCtx,
    );

    // The wrapped tool for non-write tools should be the original reference
    expect(wrapped['some_read_tool']).toBe(fakeReadTool);
  });
});

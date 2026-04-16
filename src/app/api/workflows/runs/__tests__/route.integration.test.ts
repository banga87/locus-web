/**
 * @vitest-environment node
 */
// Integration tests for POST /api/workflows/runs (trigger route).
//
// Strategy: real DB (live Supabase via DATABASE_URL), mocked auth and
// mocked waitUntil so the background runWorkflow() does not execute
// during tests. We assert on HTTP responses and the DB row state.
//
// Covered cases:
//   1. 401 without auth
//   2. 400 when preflight fails (missing requires_mcps)
//   3. 202 with { run_id, view_url } on success
//   4. workflow_runs row exists with status='running' after 202
//   5. 404 when workflow_document_id doesn't exist
//   6. 404 when document exists but type != 'workflow'
//   7. 409/400 path: invalid frontmatter returns 400

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';

// ---------------------------------------------------------------------------
// Module mocks — installed before the route is imported
// ---------------------------------------------------------------------------

// Stub requireAuth — resolved to the seeded user once beforeAll finishes.
// Uses vi.fn() so individual tests can override with mockRejectedValueOnce
// or mockResolvedValueOnce (used by the viewer-rejection test).
const mockAuth: {
  userId: string;
  companyId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  email: string;
  fullName: string;
} = {
  userId: '',
  companyId: '',
  role: 'owner',
  email: 'wf-trigger@local',
  fullName: 'WF Trigger Tester',
};

const mockRequireAuth = vi.fn(async () => ({ ...mockAuth }));

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>(
    '@/lib/api/auth',
  );
  return {
    ...actual,
    requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  };
});

// waitUntil: capture the promise but do NOT run it — we don't want
// runWorkflow to execute during route integration tests. The test for
// the run row existing (status='running') relies on createWorkflowRun
// inserting with status='running' directly, which it does.
const capturedWaitUntil: Array<Promise<unknown>> = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    capturedWaitUntil.push(p);
  },
}));

// Import the route AFTER mocks are installed.
import { POST } from '@/app/api/workflows/runs/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const suffix = `wf-trigger-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let folderId: string;
let workflowDocId: string;
let nonWorkflowDocId: string;

// Valid workflow document content with correct frontmatter.
// requires_mcps: [] so preflight always passes.
function workflowContent(): string {
  return [
    '---',
    'type: workflow',
    'output: document',
    'requires_mcps: []',
    'output_category: null',
    'schedule: null',
    '---',
    '',
    'Summarise the top 3 documents in the brain.',
  ].join('\n');
}

// Workflow that requires a (non-existent) MCP connection.
function workflowContentWithMcp(): string {
  return [
    '---',
    'type: workflow',
    'output: document',
    `requires_mcps: [${JSON.stringify(`missing-mcp-${suffix}`)}]`,
    'output_category: null',
    'schedule: null',
    '---',
    '',
    'Do something with an MCP.',
  ].join('\n');
}

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `WF Trigger Co ${suffix}`, slug: `wft-${suffix}` })
    .returning({ id: companies.id });
  companyId = company!.id;

  const mintedUserId = randomUUID();
  await db.insert(users).values({
    id: mintedUserId,
    email: `${suffix}@wf.local`,
    fullName: `WF Trigger ${suffix}`,
    role: 'owner',
    status: 'active',
    companyId,
  });
  userId = mintedUserId;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'WF Brain', slug: `wf-brain-${suffix}` })
    .returning({ id: brains.id });
  brainId = brain!.id;

  const [folder] = await db
    .insert(folders)
    .values({
      companyId,
      brainId,
      slug: `wf-folder-${suffix}`,
      name: 'Workflows',
    })
    .returning({ id: folders.id });
  folderId = folder!.id;

  // Primary workflow document (valid, no MCP requirements).
  const [wfDoc] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: 'Summarise Brain',
      slug: `summarise-brain-${suffix}`,
      path: `wf-folder-${suffix}/summarise-brain-${suffix}`,
      content: workflowContent(),
      type: 'workflow',
      // Store the structured frontmatter fields in metadata (mirrors how the
      // editor saves workflow docs — validateWorkflowFrontmatter reads this).
      metadata: {
        type: 'workflow',
        output: 'document',
        requires_mcps: [],
        output_category: null,
        schedule: null,
      },
      version: 1,
    })
    .returning({ id: documents.id });
  workflowDocId = wfDoc!.id;

  // Non-workflow document (type='knowledge') to test 404 path.
  const [nonWfDoc] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: 'Plain Knowledge Doc',
      slug: `plain-knowledge-${suffix}`,
      path: `wf-folder-${suffix}/plain-knowledge-${suffix}`,
      content: 'Just some knowledge.',
      type: 'knowledge',
      version: 1,
    })
    .returning({ id: documents.id });
  nonWorkflowDocId = nonWfDoc!.id;

  // Wire auth to the seeded user.
  mockAuth.userId = userId;
  mockAuth.companyId = companyId;
}, 60_000);

afterAll(async () => {
  // workflow_run_events ON DELETE CASCADE from workflow_runs — no need to
  // delete events explicitly. Just delete runs (and non-workflow docs) first.
  await db
    .delete(workflowRuns)
    .where(eq(workflowRuns.workflowDocumentId, workflowDocId));
  // brains ON DELETE CASCADE covers documents + folders.
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(brains).where(eq(brains.id, brainId));
  await db.delete(companies).where(eq(companies.id, companyId));
}, 60_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/workflows/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/workflows/runs', () => {
  it('returns 401 when auth fails', async () => {
    const { ApiAuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValueOnce(
      new ApiAuthError(401, 'unauthenticated', 'Sign in required.'),
    );

    const res = await POST(buildRequest({ workflow_document_id: workflowDocId }));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unauthenticated');
  });

  it('returns 403 forbidden when the caller has role=viewer', async () => {
    // Closes the permission-escalation gap: viewers must not be able to
    // trigger workflows (they would fail-closed at the first write tool
    // inside the runner anyway — reject at the gate). Pre-reject check
    // runs before the workflow doc is looked up, so a viewer can't even
    // probe which workflow IDs exist.
    mockRequireAuth.mockResolvedValueOnce({
      ...mockAuth,
      role: 'viewer',
    });

    const res = await POST(buildRequest({ workflow_document_id: workflowDocId }));
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('forbidden');
  });

  it('returns 404 when workflow_document_id does not exist', async () => {
    const res = await POST(buildRequest({ workflow_document_id: randomUUID() }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when document exists but type is not workflow', async () => {
    const res = await POST(
      buildRequest({ workflow_document_id: nonWorkflowDocId }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 with missing_mcps when preflight fails', async () => {
    // Insert a workflow doc that requires a non-existent MCP connection.
    const [mcp_doc] = await db
      .insert(documents)
      .values({
        companyId,
        brainId,
        folderId,
        title: 'MCP Workflow',
        slug: `mcp-workflow-${suffix}`,
        path: `wf-folder-${suffix}/mcp-workflow-${suffix}`,
        content: workflowContentWithMcp(),
        type: 'workflow',
        metadata: {
          type: 'workflow',
          output: 'document',
          requires_mcps: [`missing-mcp-${suffix}`],
          output_category: null,
          schedule: null,
        },
        version: 1,
      })
      .returning({ id: documents.id });

    try {
      const res = await POST(
        buildRequest({ workflow_document_id: mcp_doc!.id }),
      );
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; missing: string[] };
      expect(body.error).toBe('missing_mcps');
      expect(body.missing).toContain(`missing-mcp-${suffix}`);
    } finally {
      await db.delete(documents).where(eq(documents.id, mcp_doc!.id));
    }
  });

  it('returns 202 with run_id and view_url on success', async () => {
    capturedWaitUntil.length = 0;

    const res = await POST(buildRequest({ workflow_document_id: workflowDocId }));
    expect(res.status).toBe(202);

    const body = await res.json() as { run_id: string; view_url: string };
    expect(typeof body.run_id).toBe('string');
    expect(body.run_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.view_url).toContain(body.run_id);

    // waitUntil was called once with the runWorkflow promise.
    expect(capturedWaitUntil).toHaveLength(1);

    // workflow_runs row exists with status='running'.
    const [run] = await db
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, body.run_id))
      .limit(1);

    expect(run).toBeDefined();
    expect(run!.status).toBe('running');

    // Clean up the run row so afterAll teardown is clean.
    await db.delete(workflowRuns).where(eq(workflowRuns.id, body.run_id));
  });

  it('returns 400 for missing workflow_document_id field', async () => {
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/workflows/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

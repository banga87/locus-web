// Tests for the workflow-doc frontmatter → metadata sync in the PATCH route.
//
// When a workflow doc's body is updated with new YAML frontmatter (e.g. a
// changed requires_mcps array), the PATCH handler parses the body's
// frontmatter block with js-yaml, validates it via validateWorkflowFrontmatter,
// and mirrors the authored fields into documents.metadata. Without this sync
// the trigger route's preflight reads stale metadata and the user's edits
// are silently invisible at run time.
//
// Strategy: mock auth + brain lookup, and use a query-builder mock that
// records the `.set()` payload on the update() chain so we can assert on
// the exact metadata the route writes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Auth mock ------------------------------------------------------------

const requireAuth = vi.fn();
const requireRole = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  requireRole: (...a: unknown[]) => requireRole(...a),
}));

// ---- Brain / manifest mocks ----------------------------------------------

vi.mock('@/lib/brain/queries', () => ({
  getBrainForCompany: vi.fn(async () => ({ id: 'brain-1', companyId: 'co-1' })),
}));

vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: vi.fn(async () => {}),
}));

vi.mock('@/lib/ingestion/attachments', () => ({
  getAttachment: vi.fn(async () => null),
  markCommitted: vi.fn(async () => {}),
}));

// ---- DB mock --------------------------------------------------------------
//
// A small builder that returns scripted results for terminal awaits but
// also captures the most recent .set() and .values() payloads so the test
// can inspect exactly what the route wrote.
//
// Unlike the Proxy-based mock in ../../__tests__/documents.test.ts (which
// swallows method calls), this mock exposes the writes via the `writes`
// object so we can assert on the metadata shape.

interface WriteCapture {
  setPayloads: Array<Record<string, unknown>>;
  valuesPayloads: Array<Record<string, unknown>>;
}
const writes: WriteCapture = { setPayloads: [], valuesPayloads: [] };

let nextResults: unknown[] = [];

function popResult() {
  return nextResults.shift() ?? [];
}

function makeBuilder() {
  // Each builder is a "thenable" — awaiting it pops the next scripted
  // result. Chain methods return the same builder.
  const b: Record<string, unknown> = {};
  b.where = () => b;
  b.limit = () => b;
  b.orderBy = () => b;
  b.leftJoin = () => b;
  b.innerJoin = () => b;
  b.from = () => b;
  b.returning = () => b;
  b.set = (payload: Record<string, unknown>) => {
    writes.setPayloads.push(payload);
    return b;
  };
  b.values = (payload: Record<string, unknown>) => {
    writes.valuesPayloads.push(payload);
    return b;
  };
  b.then = (resolve: (v: unknown) => void) => resolve(popResult());
  return b;
}

vi.mock('@/db', () => ({
  db: {
    select: () => makeBuilder(),
    insert: () => makeBuilder(),
    update: () => makeBuilder(),
    delete: () => makeBuilder(),
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  or: (...a: unknown[]) => a,
  eq: () => undefined,
  desc: () => undefined,
  asc: () => undefined,
  isNull: () => undefined,
  lt: () => undefined,
  max: () => undefined,
  sql: Object.assign(() => undefined, { raw: () => undefined }),
}));

vi.mock('@/db/schema', () => ({
  documents: {},
  documentVersions: {},
  folders: {},
  users: {},
}));

// ---- Subject --------------------------------------------------------------

import { PATCH as itemPATCH } from '@/app/api/brain/documents/[id]/route';

function ctxOf(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  return {
    userId: 'u-1',
    companyId: 'co-1',
    role,
    email: 'a@example.com',
    fullName: 'Alice',
  };
}

function makeReq(body: unknown) {
  return new Request('http://x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: 'd-1' });

const workflowDoc = {
  id: 'd-1',
  companyId: 'co-1',
  brainId: 'brain-1',
  folderId: 'f-1',
  title: 'Workflow',
  slug: 'wf',
  path: 'folder/wf',
  content:
    '---\ntype: workflow\noutput: document\noutput_category: null\nrequires_mcps:\n  - sentry\nschedule: null\n---\n\nbody',
  summary: null,
  status: 'draft',
  ownerId: 'u-1',
  confidenceLevel: 'medium',
  isCore: false,
  version: 1,
  tags: [],
  relatedDocuments: [],
  // existing metadata — seeded to simulate a prior sync.
  metadata: {
    outbound_links: [],
    output: 'document',
    output_category: null,
    requires_mcps: ['sentry'],
    schedule: null,
  },
  type: 'workflow',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  tokenEstimate: 0,
};

beforeEach(() => {
  requireAuth.mockReset();
  requireRole.mockReset();
  nextResults = [];
  writes.setPayloads = [];
  writes.valuesPayloads = [];
});

describe('PATCH /api/brain/documents/[id] — workflow frontmatter sync', () => {
  it('syncs requires_mcps from body YAML into documents.metadata', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});

    // Script the reads: 1) existing-doc lookup 2) update returning 3) insert version
    nextResults.push([workflowDoc]);
    nextResults.push([{ ...workflowDoc, version: 2 }]);
    nextResults.push([]);

    // New content: requires_mcps expanded from [sentry] to [sentry, posthog]
    const newContent = [
      '---',
      'type: workflow',
      'output: document',
      'output_category: null',
      'requires_mcps:',
      '  - sentry',
      '  - posthog',
      'schedule: null',
      '---',
      '',
      'updated body',
    ].join('\n');

    const res = await itemPATCH(makeReq({ content: newContent }), { params });
    expect(res.status).toBe(200);

    // The update's .set() payload should carry metadata with the new MCPs.
    const updateSet = writes.setPayloads.find(
      (p) => p.metadata !== undefined,
    );
    expect(updateSet).toBeDefined();

    const metadata = updateSet!.metadata as Record<string, unknown>;
    expect(metadata.requires_mcps).toEqual(['sentry', 'posthog']);
    expect(metadata.output).toBe('document');
    expect(metadata.output_category).toBeNull();
    expect(metadata.schedule).toBeNull();
    // Existing non-workflow metadata fields are preserved:
    expect(metadata.outbound_links).toBeDefined();
  });

  it('silently skips sync when YAML is malformed; existing metadata preserved', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});

    nextResults.push([workflowDoc]);
    nextResults.push([{ ...workflowDoc, version: 2 }]);
    nextResults.push([]);

    // Broken YAML — unbalanced brackets, colon syntax mangled.
    const brokenContent = [
      '---',
      'type: workflow',
      'output: document',
      'requires_mcps: [sentry, posthog',  // missing closing bracket
      '---',
      '',
      'body',
    ].join('\n');

    const res = await itemPATCH(
      makeReq({ content: brokenContent }),
      { params },
    );
    expect(res.status).toBe(200);

    // Sync should skip silently. The update's metadata in .set() should
    // NOT include the new workflow fields — it only has outbound_links
    // (preserved existing metadata flows through from the spread).
    const updateSet = writes.setPayloads.find(
      (p) => p.metadata !== undefined,
    );
    expect(updateSet).toBeDefined();

    const metadata = updateSet!.metadata as Record<string, unknown>;
    // The ORIGINAL metadata's requires_mcps value (from existing) is preserved
    // via the existingMetadata spread — NOT the broken parse's result.
    expect(metadata.requires_mcps).toEqual(['sentry']);
  });

  it('does not sync workflow fields for non-workflow docs', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});

    // Plain knowledge doc (type: null), not a workflow.
    const plainDoc = {
      ...workflowDoc,
      type: null,
      metadata: { outbound_links: [] },
    };
    nextResults.push([plainDoc]);
    nextResults.push([{ ...plainDoc, version: 2 }]);
    nextResults.push([]);

    // Even if body accidentally contains a workflow-shaped frontmatter,
    // a plain doc (type: null) won't sync workflow fields. Here the new
    // content has no frontmatter at all.
    const newContent = 'plain markdown body, no frontmatter';

    const res = await itemPATCH(makeReq({ content: newContent }), { params });
    expect(res.status).toBe(200);

    const updateSet = writes.setPayloads.find(
      (p) => p.metadata !== undefined,
    );
    expect(updateSet).toBeDefined();

    const metadata = updateSet!.metadata as Record<string, unknown>;
    // Non-workflow doc gets outbound_links recomputed; no workflow fields
    // appear because the sync is scoped to newType === 'workflow'.
    expect(metadata.output).toBeUndefined();
    expect(metadata.requires_mcps).toBeUndefined();
  });
});

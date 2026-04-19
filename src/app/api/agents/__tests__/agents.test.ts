// Integration tests for /api/agents and /api/agents/[id].
//
// Mirrors the pattern established in
// `src/app/api/brain/__tests__/documents.test.ts`: mock `@/lib/api/auth`
// so we can script auth outcomes, mock `@/db` with a chainable Proxy
// that pops scripted results, and mock the manifest regen as a no-op.
// Then call the route handlers directly — no HTTP server, no Supabase.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Auth mock -----------------------------------------------------------

const requireAuth = vi.fn();
const requireRole = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  requireRole: (...a: unknown[]) => requireRole(...a),
}));

// ---- Manifest regen mock -------------------------------------------------
//
// Exposed as a module-scoped spy so individual tests can assert the
// brain-manifest regen fires on create/update/delete.

const tryRegenerateManifest = vi.fn(async (_brainId: string) => {});
vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: (...a: [string]) => tryRegenerateManifest(...a),
}));

vi.mock('@/lib/brain/save', () => ({
  extractDocumentTypeFromContent: () => 'agent-definition',
}));

// ---- Brain lookup mock ---------------------------------------------------

vi.mock('@/lib/brain/queries', () => ({
  getBrainForCompany: vi.fn(async () => ({ id: 'brain-1', companyId: 'co-1' })),
}));

// ---- DB mock — chainable builder that pops scripted results ---------------

let nextResults: unknown[] = [];
function popResult() {
  return nextResults.shift() ?? [];
}

type Q = Record<string, (..._: unknown[]) => Q> & { _end: () => Promise<unknown> };
function chain(): Q {
  const q = {} as Q;
  const self = new Proxy(q, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(popResult());
      }
      return () => self;
    },
  });
  return self;
}

vi.mock('@/db', () => ({
  db: {
    select: () => chain(),
    insert: () => chain(),
    update: () => chain(),
    delete: () => chain(),
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
  sessions: {},
}));

// ---- Subjects ------------------------------------------------------------

import { GET as listGET, POST as listPOST } from '@/app/api/agents/route';
import {
  GET as itemGET,
  PATCH as itemPATCH,
  DELETE as itemDELETE,
} from '@/app/api/agents/[id]/route';
import { ApiAuthError } from '@/lib/api/errors';

type Role = 'owner' | 'admin' | 'editor' | 'viewer';
function ctxOf(role: Role, companyId: string | null = 'co-1') {
  return {
    userId: 'u-1',
    companyId,
    role,
    email: 'a@example.com',
    fullName: 'Alice',
  };
}

beforeEach(() => {
  requireAuth.mockReset();
  requireRole.mockReset();
  tryRegenerateManifest.mockClear();
  nextResults = [];
});

// Sample agent-definition document row. Uses the same frontmatter
// `buildAgentDefinitionDoc` would produce so GET / PATCH round-trips
// mirror production data.
const sampleContent = `---
type: agent-definition
title: Marketing Copywriter
slug: marketing-copywriter
model: claude-sonnet-4-6
tool_allowlist: null
baseline_docs: []
skills: []
system_prompt_snippet: You are a copywriter.
---
`;

const sampleAgent = {
  id: 'd-1',
  companyId: 'co-1',
  brainId: 'brain-1',
  folderId: null,
  title: 'Marketing Copywriter',
  slug: 'marketing-copywriter',
  path: 'agents/marketing-copywriter',
  content: sampleContent,
  summary: null,
  status: 'active',
  ownerId: 'u-1',
  confidenceLevel: 'medium',
  isCore: false,
  type: 'agent-definition',
  version: 1,
  tags: [],
  relatedDocuments: [],
  metadata: {},
  createdAt: new Date('2026-04-14T00:00:00Z'),
  updatedAt: new Date('2026-04-14T00:00:00Z'),
  deletedAt: null,
  tokenEstimate: 0,
};

function makeReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ------------------------------------------------------------------------
// POST /api/agents
// ------------------------------------------------------------------------

describe('POST /api/agents', () => {
  const validBody = {
    title: 'Marketing Copywriter',
    slug: 'marketing-copywriter',
    model: 'claude-sonnet-4-6',
    baselineDocIds: [],
    skillIds: [],
    systemPromptSnippet: 'You are a copywriter.',
  };

  it('401 when unauthenticated', async () => {
    requireAuth.mockRejectedValue(
      new ApiAuthError(401, 'unauthenticated', 'Sign in required.'),
    );
    const res = await listPOST(
      makeReq('http://x/api/agents', 'POST', validBody),
    );
    expect(res.status).toBe(401);
  });

  it('403 when viewer tries to create', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    requireRole.mockImplementation((_c, min) => {
      throw new ApiAuthError(403, 'insufficient_role', `Requires ${min}`);
    });
    const res = await listPOST(
      makeReq('http://x/api/agents', 'POST', validBody),
    );
    expect(res.status).toBe(403);
  });

  it('400 when body is not JSON', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    const req = new Request('http://x/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await listPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_json');
  });

  it('400 invalid_body on bad slug', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    const res = await listPOST(
      makeReq('http://x/api/agents', 'POST', {
        ...validBody,
        slug: 'Bad Slug With Spaces',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_body');
  });

  it('400 invalid_body on disallowed model', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    const res = await listPOST(
      makeReq('http://x/api/agents', 'POST', {
        ...validBody,
        model: 'gpt-4',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_body');
  });

  it('409 slug_conflict when another agent-definition owns the slug', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    // Slug conflict lookup — returns an existing row.
    nextResults.push([{ id: 'd-other' }]);
    const res = await listPOST(
      makeReq('http://x/api/agents', 'POST', validBody),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('slug_conflict');
  });

  it('201 happy path creates an agent-definition doc', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    // 1st select: slug conflict lookup — none.
    nextResults.push([]);
    // 2nd call: insert documents -> returning.
    nextResults.push([sampleAgent]);
    // 3rd call: insert document_versions.
    nextResults.push([]);

    const res = await listPOST(
      makeReq('http://x/api/agents', 'POST', validBody),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.type).toBe('agent-definition');
    expect(body.data.slug).toBe('marketing-copywriter');
    expect(body.data.path).toBe('agents/marketing-copywriter');
    // Manifest regen fires for the owning brain.
    expect(tryRegenerateManifest).toHaveBeenCalledTimes(1);
    expect(tryRegenerateManifest).toHaveBeenCalledWith('brain-1');
  });
});

// ------------------------------------------------------------------------
// GET /api/agents
// ------------------------------------------------------------------------

describe('GET /api/agents', () => {
  it('401 when unauthenticated', async () => {
    requireAuth.mockRejectedValue(
      new ApiAuthError(401, 'unauthenticated', 'Sign in required.'),
    );
    const res = await listGET();
    expect(res.status).toBe(401);
  });

  it('200 lists agent-definitions', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([sampleAgent]);
    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.agents).toHaveLength(1);
    expect(body.data.agents[0].type).toBe('agent-definition');
  });
});

// ------------------------------------------------------------------------
// GET /api/agents/[id]
// ------------------------------------------------------------------------

describe('GET /api/agents/[id]', () => {
  const params = Promise.resolve({ id: 'd-1' });

  it('404 when not found', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([]);
    const res = await itemGET(new Request('http://x'), { params });
    expect(res.status).toBe(404);
  });

  it('404 when doc exists but is not an agent-definition', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([{ ...sampleAgent, type: 'skill' }]);
    const res = await itemGET(new Request('http://x'), { params });
    expect(res.status).toBe(404);
  });

  it('200 returns the agent with parsed frontmatter fields', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([sampleAgent]);
    const res = await itemGET(new Request('http://x'), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.type).toBe('agent-definition');
    expect(body.data.model).toBe('claude-sonnet-4-6');
    expect(body.data.systemPromptSnippet).toBe('You are a copywriter.');
  });
});

// ------------------------------------------------------------------------
// PATCH /api/agents/[id]
// ------------------------------------------------------------------------

describe('PATCH /api/agents/[id]', () => {
  const params = Promise.resolve({ id: 'd-1' });

  it('400 when body is empty', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    const res = await itemPATCH(makeReq('http://x', 'PATCH', {}), { params });
    expect(res.status).toBe(400);
  });

  it('404 when agent missing', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]);
    const res = await itemPATCH(
      makeReq('http://x', 'PATCH', { title: 'New title' }),
      { params },
    );
    expect(res.status).toBe(404);
  });

  it('200 updates title and writes new version', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    // 1st: existing agent fetch.
    nextResults.push([sampleAgent]);
    // 2nd: update -> returning.
    nextResults.push([
      { ...sampleAgent, title: 'New title', version: 2 },
    ]);
    // 3rd: insert document_versions.
    nextResults.push([]);
    const res = await itemPATCH(
      makeReq('http://x', 'PATCH', { title: 'New title' }),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe('New title');
    expect(body.data.version).toBe(2);
    // Manifest regen fires exactly once, for this brain only.
    expect(tryRegenerateManifest).toHaveBeenCalledTimes(1);
    expect(tryRegenerateManifest).toHaveBeenCalledWith('brain-1');
  });

  it('500 corrupt_agent when stored frontmatter has no model and patch does not supply one', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    // Frontmatter with `model` field stripped — simulates a stored doc
    // corrupted or produced by an older buggy write path.
    const corruptContent = `---
type: agent-definition
title: Marketing Copywriter
slug: marketing-copywriter
tool_allowlist: null
baseline_docs: []
skills: []
system_prompt_snippet: You are a copywriter.
---
`;
    nextResults.push([{ ...sampleAgent, content: corruptContent }]);
    const res = await itemPATCH(
      makeReq('http://x', 'PATCH', { title: 'New title' }),
      { params },
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('corrupt_agent');
    // No manifest regen — we bail before the write.
    expect(tryRegenerateManifest).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------
// DELETE /api/agents/[id]
// ------------------------------------------------------------------------

describe('DELETE /api/agents/[id]', () => {
  const params = Promise.resolve({ id: 'd-1' });

  it('403 when editor tries to delete', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation((_c, min) => {
      if (min === 'owner')
        throw new ApiAuthError(403, 'insufficient_role', 'owner');
    });
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(403);
  });

  it('404 when agent missing', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]);
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(404);
  });

  it('409 when an active session references the agent', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([sampleAgent]); // existing
    nextResults.push([{ id: 's-1' }, { id: 's-2' }]); // active sessions
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('agent_in_use');
    expect(body.error.details.session_ids).toEqual(['s-1', 's-2']);
  });

  it('200 soft-deletes when no active sessions reference it', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([sampleAgent]); // existing
    nextResults.push([]); // no active sessions
    nextResults.push([]); // update returning (not used here)
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ id: 'd-1' });
    // Manifest regen fires on soft-delete so the brain manifest drops
    // the entry.
    expect(tryRegenerateManifest).toHaveBeenCalledTimes(1);
    expect(tryRegenerateManifest).toHaveBeenCalledWith('brain-1');
  });
});

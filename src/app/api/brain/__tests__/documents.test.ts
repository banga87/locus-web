// Unit tests for /api/brain/documents and /api/brain/documents/[id].
//
// Strategy: mock @/lib/api/auth so we can script requireAuth responses,
// mock @/db so we control query results, mock manifest regen to a no-op,
// then call the exported route handlers directly.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Auth mock -----------------------------------------------------------

const requireAuth = vi.fn();
const requireRole = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  requireRole: (...a: unknown[]) => requireRole(...a),
}));

// ---- Manifest regen mock -------------------------------------------------

vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: vi.fn(async () => {}),
}));

// ---- Brain lookup mock ---------------------------------------------------

vi.mock('@/lib/brain/queries', () => ({
  getBrainForCompany: vi.fn(async () => ({ id: 'brain-1', companyId: 'co-1' })),
}));

// ---- DB mock — a chainable builder that records calls ---------------------
//
// Each top-level db.select/insert/update/delete returns a new query-builder
// whose terminal methods (limit, returning, orderBy) resolve to scripted
// values set by the individual test via `nextResult`.

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
        // support `await` on a chain that hasn't hit a terminal
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
  folders: {},
  users: {},
  navigationManifests: {},
}));

// ---- Subjects ------------------------------------------------------------

import { GET as listGET, POST as listPOST } from '@/app/api/brain/documents/route';
import {
  GET as itemGET,
  PATCH as itemPATCH,
  DELETE as itemDELETE,
} from '@/app/api/brain/documents/[id]/route';
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
  nextResults = [];
});

// Helper: typical query answers for a document row.
const sampleDoc = {
  id: 'd-1',
  companyId: 'co-1',
  brainId: 'brain-1',
  folderId: 'f-1',
  title: 'Doc',
  slug: 'doc',
  path: 'cat/doc',
  content: 'hello',
  summary: null,
  status: 'draft',
  ownerId: 'u-1',
  confidenceLevel: 'medium',
  isCore: false,
  version: 1,
  tags: [],
  relatedDocuments: [],
  metadata: {},
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  tokenEstimate: 0,
};

// ------------------------------------------------------------------------
// GET /api/brain/documents
// ------------------------------------------------------------------------

describe('GET /api/brain/documents', () => {
  it('401 when requireAuth throws unauthenticated', async () => {
    requireAuth.mockRejectedValue(new ApiAuthError(401, 'unauthenticated', 'nope'));
    const res = await listGET(new Request('http://x/api/brain/documents'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: 'unauthenticated', message: 'nope', details: undefined },
    });
  });

  it('403 when user has no company', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer', null));
    const res = await listGET(new Request('http://x/api/brain/documents'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('no_company');
  });

  it('returns paginated list (viewer ok) with nextCursor when more rows', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    // db chain call: select...where...orderBy...limit -> returns rows
    const rows = Array.from({ length: 51 }, (_, i) => ({
      ...sampleDoc,
      id: `d-${i}`,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
    }));
    nextResults.push(rows);
    const res = await listGET(new Request('http://x/api/brain/documents?limit=50'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(50);
    expect(body.pagination.nextCursor).toBeTypeOf('string');
  });

  it('cursor round-trips without error', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([]);
    const cursor = Buffer.from(
      JSON.stringify({ updatedAt: new Date().toISOString(), id: 'x' }),
    ).toString('base64url');
    const res = await listGET(
      new Request(`http://x/api/brain/documents?cursor=${cursor}`),
    );
    expect(res.status).toBe(200);
  });
});

// ------------------------------------------------------------------------
// POST /api/brain/documents
// ------------------------------------------------------------------------

describe('POST /api/brain/documents', () => {
  function makeReq(body: unknown) {
    return new Request('http://x/api/brain/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('403 when viewer tries to create (role gate)', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    requireRole.mockImplementation((_ctx: unknown, min: string) => {
      throw new ApiAuthError(403, 'insufficient_role', `Requires ${min} or higher.`);
    });
    const res = await listPOST(
      makeReq({ title: 'x', slug: 'x', content: '', folderId: 'f-1' }),
    );
    expect(res.status).toBe(403);
  });

  it('400 invalid_json on non-JSON body', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    const req = new Request('http://x/api/brain/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await listPOST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_json');
  });

  it('400 invalid_body when slug is not kebab-case', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    const res = await listPOST(
      makeReq({
        title: 'x',
        slug: 'Bad Slug!',
        content: '',
        folderId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_body');
  });

  it('400 folder_not_found when folder is not in brain', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    // folder lookup returns []
    nextResults.push([]);
    const res = await listPOST(
      makeReq({
        title: 'x',
        slug: 'x',
        content: '',
        folderId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('folder_not_found');
  });

  it('201 created with isCore forced false and version=1', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    // 1st: folder lookup — found
    nextResults.push([{ id: 'f-1', brainId: 'brain-1', slug: 'folder' }]);
    // 2nd: insert documents returning
    nextResults.push([{ ...sampleDoc, isCore: false, version: 1 }]);
    // 3rd: insert document_versions (no returning — Proxy auto-resolves)
    nextResults.push([]);
    const res = await listPOST(
      makeReq({
        title: 'x',
        slug: 'x',
        content: 'hello',
        folderId: '11111111-1111-4111-8111-111111111111',
        isCore: true, // smuggled — must be ignored (Zod strip)
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.isCore).toBe(false);
    expect(body.data.version).toBe(1);
  });
});

// ------------------------------------------------------------------------
// GET /api/brain/documents/[id]
// ------------------------------------------------------------------------

describe('GET /api/brain/documents/[id]', () => {
  const params = Promise.resolve({ id: 'd-1' });

  it('404 when not found', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([]); // join query -> no rows
    const res = await itemGET(new Request('http://x'), { params });
    expect(res.status).toBe(404);
  });

  it('200 returns document with joined owner email + folder name', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([
      {
        ...sampleDoc,
        ownerEmail: 'a@example.com',
        folderName: 'Brand',
      },
    ]);
    const res = await itemGET(new Request('http://x'), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ownerEmail).toBe('a@example.com');
    expect(body.data.folderName).toBe('Brand');
  });
});

// ------------------------------------------------------------------------
// PATCH /api/brain/documents/[id]
// ------------------------------------------------------------------------

describe('PATCH /api/brain/documents/[id]', () => {
  const params = Promise.resolve({ id: 'd-1' });

  function makeReq(body: unknown) {
    return new Request('http://x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('403 when viewer tries to patch', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    requireRole.mockImplementation((_c, min) => {
      throw new ApiAuthError(403, 'insufficient_role', `Requires ${min}`);
    });
    const res = await itemPATCH(makeReq({ title: 'new' }), { params });
    expect(res.status).toBe(403);
  });

  it('silently ignores isCore in PATCH body', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    // existing doc
    nextResults.push([{ ...sampleDoc, isCore: false }]);
    // update returning
    nextResults.push([{ ...sampleDoc, version: 2, isCore: false, title: 'new' }]);
    // insert version
    nextResults.push([]);
    const res = await itemPATCH(
      makeReq({ title: 'new', isCore: true }),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.isCore).toBe(false);
    expect(body.data.version).toBe(2);
  });

  it('404 when document missing', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]); // existing lookup empty
    const res = await itemPATCH(makeReq({ title: 'new' }), { params });
    expect(res.status).toBe(404);
  });

  it('400 when no patch fields provided', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    const res = await itemPATCH(makeReq({}), { params });
    expect(res.status).toBe(400);
  });
});

// ------------------------------------------------------------------------
// DELETE /api/brain/documents/[id]
// ------------------------------------------------------------------------

describe('DELETE /api/brain/documents/[id]', () => {
  const params = Promise.resolve({ id: 'd-1' });

  it('403 when editor tries to delete', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation((_c, min) => {
      if (min === 'owner') throw new ApiAuthError(403, 'insufficient_role', 'owner');
    });
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(403);
  });

  it('403 core_document_protected when document is core', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ ...sampleDoc, isCore: true }]);
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('core_document_protected');
  });

  it('200 soft-deletes non-core', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ ...sampleDoc, isCore: false }]);
    nextResults.push([]); // update result
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 'd-1' });
  });

  it('404 when doc not found', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]);
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(404);
  });
});

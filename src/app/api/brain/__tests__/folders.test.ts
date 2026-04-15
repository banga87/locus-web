// Unit tests for /api/brain/folders routes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuth = vi.fn();
const requireRole = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  requireRole: (...a: unknown[]) => requireRole(...a),
}));

vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: vi.fn(async () => {}),
}));

vi.mock('@/lib/brain/queries', () => ({
  getBrainForCompany: vi.fn(async () => ({ id: 'brain-1', companyId: 'co-1' })),
}));

let nextResults: unknown[] = [];
function popResult() {
  return nextResults.shift() ?? [];
}

type Q = Record<string, (..._: unknown[]) => Q>;
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
  eq: () => undefined,
  desc: () => undefined,
  asc: () => undefined,
  max: () => undefined,
  isNull: () => undefined,
}));

vi.mock('@/db/schema', () => ({
  folders: {},
  documents: {},
}));

import { GET as listGET, POST as listPOST } from '@/app/api/brain/folders/route';
import {
  PATCH as itemPATCH,
  DELETE as itemDELETE,
} from '@/app/api/brain/folders/[id]/route';
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

describe('GET /api/brain/folders', () => {
  it('401 when unauthenticated', async () => {
    requireAuth.mockRejectedValue(new ApiAuthError(401, 'unauthenticated', 'no'));
    const res = await listGET();
    expect(res.status).toBe(401);
  });

  it('403 when no company', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer', null));
    const res = await listGET();
    expect(res.status).toBe(403);
  });

  it('200 lists folders sorted', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([
      { id: 'f-1', slug: 'brand', name: 'Brand', sortOrder: 10, parentId: null },
      { id: 'f-2', slug: 'pricing', name: 'Pricing', sortOrder: 20, parentId: null },
    ]);
    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });
});

describe('POST /api/brain/folders', () => {
  function makeReq(body: unknown) {
    return new Request('http://x/api/brain/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('403 when viewer tries to create', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    requireRole.mockImplementation((_c, min) => {
      throw new ApiAuthError(403, 'insufficient_role', `Requires ${min}`);
    });
    const res = await listPOST(makeReq({ name: 'Brand', slug: 'brand' }));
    expect(res.status).toBe(403);
  });

  it('400 invalid slug', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    const res = await listPOST(makeReq({ name: 'Brand', slug: 'Bad Slug!' }));
    expect(res.status).toBe(400);
  });

  it('409 slug_conflict on pre-check (top-level sibling)', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    // dup check returns existing row
    nextResults.push([{ id: 'f-0' }]);
    const res = await listPOST(makeReq({ name: 'Brand', slug: 'brand' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('slug_conflict');
  });

  it('201 created at top level with auto sortOrder', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]); // dup check: no dupe
    nextResults.push([{ max: 40 }]); // max sortOrder
    nextResults.push([
      { id: 'f-new', name: 'Processes', slug: 'processes', sortOrder: 50, parentId: null },
    ]);
    const res = await listPOST(makeReq({ name: 'Processes', slug: 'processes' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.sortOrder).toBe(50);
    expect(body.data.parentId).toBeNull();
  });

  const PARENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const PARENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const NONEXISTENT_PARENT = '11111111-2222-4333-8444-555555555555';

  it('400 parent_not_found when parentId does not exist in brain', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]); // parent lookup: not found
    const res = await listPOST(
      makeReq({ name: 'Child', slug: 'child', parentId: NONEXISTENT_PARENT }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('parent_not_found');
  });

  it('201 creates a nested folder under a valid parent', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ id: PARENT_A }]); // parent exists
    nextResults.push([]); // no sibling dupe
    nextResults.push([{ max: 0 }]); // max among siblings
    nextResults.push([
      {
        id: 'child-1',
        name: 'Onboarding',
        slug: 'onboarding',
        parentId: PARENT_A,
        sortOrder: 10,
      },
    ]);
    const res = await listPOST(
      makeReq({ name: 'Onboarding', slug: 'onboarding', parentId: PARENT_A }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.parentId).toBe(PARENT_A);
  });

  it('409 slug_conflict when same slug already used under the same parent', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ id: PARENT_A }]); // parent exists
    nextResults.push([{ id: 'child-dup' }]); // sibling with same slug
    const res = await listPOST(
      makeReq({ name: 'Onboarding', slug: 'onboarding', parentId: PARENT_A }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('slug_conflict');
  });

  it('201 allows same slug under a different parent (scoped uniqueness)', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ id: PARENT_B }]); // parent exists
    nextResults.push([]); // no dupe under THIS parent
    nextResults.push([{ max: 0 }]);
    nextResults.push([
      {
        id: 'child-2',
        name: 'Onboarding',
        slug: 'onboarding',
        parentId: PARENT_B,
        sortOrder: 10,
      },
    ]);
    const res = await listPOST(
      makeReq({ name: 'Onboarding', slug: 'onboarding', parentId: PARENT_B }),
    );
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/brain/folders/[id]', () => {
  const params = Promise.resolve({ id: 'f-1' });

  function makeReq(body: unknown) {
    return new Request('http://x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('403 when viewer patches', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    requireRole.mockImplementation((_c, min) => {
      throw new ApiAuthError(403, 'insufficient_role', `Requires ${min}`);
    });
    const res = await itemPATCH(makeReq({ name: 'X' }), { params });
    expect(res.status).toBe(403);
  });

  it('ignores slug in patch body (strip)', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ id: 'f-1', slug: 'brand', name: 'Brand' }]);
    nextResults.push([{ id: 'f-1', slug: 'brand', name: 'Renamed' }]);
    const res = await itemPATCH(
      makeReq({ name: 'Renamed', slug: 'smuggled' }),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.slug).toBe('brand');
  });

  it('404 when not found', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]);
    const res = await itemPATCH(makeReq({ name: 'X' }), { params });
    expect(res.status).toBe(404);
  });

  it('400 when no patch fields', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    const res = await itemPATCH(makeReq({}), { params });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/brain/folders/[id]', () => {
  const params = Promise.resolve({ id: 'f-1' });

  it('403 when editor tries to delete', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation((_c, min) => {
      if (min === 'owner') throw new ApiAuthError(403, 'insufficient_role', 'owner');
    });
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(403);
  });

  it('200 deletes as owner when folder is empty', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ id: 'f-1' }]); // existing
    nextResults.push([]); // no child folders
    nextResults.push([]); // no child documents
    nextResults.push([]); // delete
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ id: 'f-1' });
  });

  it('409 folder_has_children when sub-folders exist', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ id: 'f-1' }]); // existing
    nextResults.push([{ id: 'f-child' }]); // a child folder
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('folder_has_children');
  });

  it('409 folder_has_documents when non-deleted documents exist', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ id: 'f-1' }]); // existing
    nextResults.push([]); // no child folders
    nextResults.push([{ id: 'doc-1' }]); // a child document
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('folder_has_documents');
  });

  it('404 when not found', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]);
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(404);
  });
});

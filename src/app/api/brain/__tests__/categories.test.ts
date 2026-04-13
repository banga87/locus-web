// Unit tests for /api/brain/categories routes.

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
}));

vi.mock('@/db/schema', () => ({
  categories: {},
  documents: {},
}));

import { GET as listGET, POST as listPOST } from '@/app/api/brain/categories/route';
import {
  PATCH as itemPATCH,
  DELETE as itemDELETE,
} from '@/app/api/brain/categories/[id]/route';
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

describe('GET /api/brain/categories', () => {
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

  it('200 lists categories sorted', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([
      { id: 'c-1', slug: 'brand', name: 'Brand', sortOrder: 10 },
      { id: 'c-2', slug: 'pricing', name: 'Pricing', sortOrder: 20 },
    ]);
    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });
});

describe('POST /api/brain/categories', () => {
  function makeReq(body: unknown) {
    return new Request('http://x/api/brain/categories', {
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

  it('409 slug_conflict on pre-check', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    // dup check returns existing row
    nextResults.push([{ id: 'c-0' }]);
    const res = await listPOST(makeReq({ name: 'Brand', slug: 'brand' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('slug_conflict');
  });

  it('201 created with auto sortOrder', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]); // dup check: no dupe
    nextResults.push([{ max: 40 }]); // max sortOrder
    nextResults.push([
      { id: 'c-new', name: 'Processes', slug: 'processes', sortOrder: 50 },
    ]);
    const res = await listPOST(makeReq({ name: 'Processes', slug: 'processes' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.sortOrder).toBe(50);
  });
});

describe('PATCH /api/brain/categories/[id]', () => {
  const params = Promise.resolve({ id: 'c-1' });

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
    nextResults.push([{ id: 'c-1', slug: 'brand', name: 'Brand' }]);
    nextResults.push([{ id: 'c-1', slug: 'brand', name: 'Renamed' }]);
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

describe('DELETE /api/brain/categories/[id]', () => {
  const params = Promise.resolve({ id: 'c-1' });

  it('403 when editor tries to delete', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation((_c, min) => {
      if (min === 'owner') throw new ApiAuthError(403, 'insufficient_role', 'owner');
    });
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(403);
  });

  it('200 deletes as owner, orphans documents', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([{ id: 'c-1' }]);
    nextResults.push([]); // update documents
    nextResults.push([]); // delete category
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ id: 'c-1' });
  });

  it('404 when not found', async () => {
    requireAuth.mockResolvedValue(ctxOf('owner'));
    requireRole.mockImplementation(() => {});
    nextResults.push([]);
    const res = await itemDELETE(new Request('http://x'), { params });
    expect(res.status).toBe(404);
  });
});

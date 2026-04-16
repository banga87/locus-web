// Unit tests for GET /api/brain/[slug]/graph.
//
// Strategy: mirrors the mocking pattern from
// src/app/api/brain/__tests__/documents.test.ts — chainable-builder DB mock
// controlled by `nextResults`, requireAuth scripted via vi.fn().
//
// Happy path: deferred to T21 (RLS integration test against live DB).
// The chained mock cannot easily assert that all three parallel selects
// return correct shaped data without knowing the query order, and the real
// security boundary (cross-company slug lookup) is enforced by the DB
// query scoped to companyId — that's what T21's live-DB test will cover.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Auth mock -----------------------------------------------------------

const requireAuth = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
}));

// ---- DB mock — chainable builder identical to documents.test.ts ----------

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
  eq: () => undefined,
  isNull: () => undefined,
}));

vi.mock('@/db/schema', () => ({
  brains: {},
  documents: {},
  folders: {},
  mcpConnections: {},
}));

// ---- deriveGraph mock — returns a predictable payload --------------------

vi.mock('@/lib/graph/derive-graph', () => ({
  deriveGraph: vi.fn(() => ({
    brain: { id: 'b-1', slug: 'acme', name: 'Acme Brain' },
    nodes: [],
    edges: [],
    clusters: [],
    mcpConnections: [],
  })),
}));

// ---- Subject -------------------------------------------------------------

import { GET } from '@/app/api/brain/[slug]/graph/route';
import { ApiAuthError } from '@/lib/api/errors';

// ---- Helpers -------------------------------------------------------------

function ctxOf(companyId: string | null = 'c1') {
  return {
    userId: 'u1',
    companyId,
    role: 'viewer' as const,
    email: 'x@x',
    fullName: null,
  };
}

const baseReq = new Request('http://localhost/api/brain/acme/graph');

beforeEach(() => {
  requireAuth.mockReset();
  nextResults = [];
});

// ---- Tests ---------------------------------------------------------------

describe('GET /api/brain/[slug]/graph', () => {
  it('401 when requireAuth throws unauthenticated', async () => {
    requireAuth.mockRejectedValue(
      new ApiAuthError(401, 'unauthenticated', 'Sign in required.'),
    );

    const res = await GET(baseReq as never, {
      params: Promise.resolve({ slug: 'acme' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: 'unauthenticated', message: 'Sign in required.', details: undefined },
    });
  });

  it('404 when no brain matches slug + companyId', async () => {
    requireAuth.mockResolvedValue(ctxOf('c1'));
    // Brain lookup returns empty — slug not owned by this company.
    nextResults.push([]);

    const res = await GET(baseReq as never, {
      params: Promise.resolve({ slug: 'acme' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: 'not_found', message: 'Brain not found.', details: undefined },
    });
  });

  it('401 when authenticated but companyId is null (pre-setup user)', async () => {
    requireAuth.mockResolvedValue(ctxOf(null));

    const res = await GET(baseReq as never, {
      params: Promise.resolve({ slug: 'acme' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthenticated');
  });
});

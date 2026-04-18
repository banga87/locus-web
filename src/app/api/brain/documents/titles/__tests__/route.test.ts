// Unit tests for /api/brain/documents/titles — batch title fetch by ID.
//
// Mirrors the mocking pattern used by ../../../__tests__/documents.test.ts:
// mock @/lib/api/auth, mock @/db with a chainable proxy, and exercise the
// exported POST handler directly.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Auth mock -----------------------------------------------------------

const requireAuth = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  requireRole: vi.fn(),
}));

// ---- DB mock — a chainable builder that records calls ---------------------

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
  inArray: () => undefined,
  isNull: () => undefined,
}));

vi.mock('@/db/schema', () => ({
  documents: {
    id: {},
    title: {},
    slug: {},
    companyId: {},
    deletedAt: {},
  },
}));

// ---- Subject -------------------------------------------------------------

import { POST } from '@/app/api/brain/documents/titles/route';
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

function makeReq(body: unknown) {
  return new Request('http://x/api/brain/documents/titles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  requireAuth.mockReset();
  nextResults = [];
});

describe('POST /api/brain/documents/titles', () => {
  // A real UUIDv4 sample — zod's .uuid() validator enforces version
  // + variant bits, so arbitrary hex strings like "aaaa-…" get rejected
  // with invalid_body before any auth/mocking comes into play.
  const UUID_A = '49f35515-2764-483e-9ba7-cb94363ae926';
  const UUID_B = '6621137b-5cf3-46af-b972-6d7681b4d8ca';

  it('401 when requireAuth throws unauthenticated', async () => {
    requireAuth.mockRejectedValue(
      new ApiAuthError(401, 'unauthenticated', 'Sign in required.'),
    );
    const res = await POST(makeReq({ ids: [UUID_A] }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('unauthenticated');
  });

  it('403 when user has no company', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer', null));
    const res = await POST(makeReq({ ids: [UUID_A] }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('no_company');
  });

  it('400 when body is not JSON', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    const res = await POST(makeReq('{not-json'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_json');
  });

  it('400 when ids is missing', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_body');
  });

  it('400 when ids is empty', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    const res = await POST(makeReq({ ids: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_body');
  });

  it('400 when ids contains a non-UUID', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    const res = await POST(makeReq({ ids: ['not-a-uuid'] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_body');
  });

  it('400 when ids exceeds the cap (50)', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    // 51 structurally valid v4-format UUIDs (varying last segment).
    const ids = Array.from({ length: 51 }, (_, i) => {
      const suffix = (i + 100).toString(16).padStart(12, '0');
      return `49f35515-2764-483e-9ba7-${suffix}`;
    });
    const res = await POST(makeReq({ ids }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_body');
  });

  it('200 returns {docs} with id/title/slug on success (viewer ok)', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([
      { id: UUID_A, title: 'One', slug: 'one' },
      { id: UUID_B, title: 'Two', slug: 'two' },
    ]);

    const res = await POST(makeReq({ ids: [UUID_A, UUID_B] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.docs).toHaveLength(2);
    expect(body.data.docs[0]).toEqual({
      id: UUID_A,
      title: 'One',
      slug: 'one',
    });
  });

  it('200 returns empty array when no matching docs (e.g. cross-tenant)', async () => {
    requireAuth.mockResolvedValue(ctxOf('viewer'));
    nextResults.push([]);
    const res = await POST(makeReq({ ids: [UUID_A] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.docs).toEqual([]);
  });
});

// Unit tests for requireAuth / requireRole.
//
// These tests mock both `@/lib/supabase/server` (so we don't need a real
// Supabase client) and `@/db` (so we don't need a real database). The goal
// is to pin down the contract: who throws, with what code, and when.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ----------------------------------------------------------------

const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}));

// The db chain: db.select().from(users).where(...).limit(1) -> array.
// Plus the insert path: db.insert(users).values(...).returning() -> array.
const limitMock = vi.fn();
const returningMock = vi.fn();
vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: limitMock,
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: returningMock,
      }),
    }),
  },
}));

// Drizzle's eq() and the users schema import are irrelevant once db is
// mocked — provide no-op stand-ins so the import graph resolves.
vi.mock('drizzle-orm', () => ({ eq: () => undefined }));
vi.mock('@/db/schema', () => ({ users: {} }));

// --- Subject --------------------------------------------------------------

import { requireAuth, requireRole, type AuthContext } from '../auth';
import { ApiAuthError } from '../errors';

beforeEach(() => {
  getUser.mockReset();
  limitMock.mockReset();
  returningMock.mockReset();
});

describe('requireAuth', () => {
  it('returns an AuthContext for an authenticated user with a profile', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u-1', email: 'a@example.com' } },
    });
    limitMock.mockResolvedValue([
      {
        id: 'u-1',
        companyId: 'c-1',
        role: 'admin',
        status: 'active',
        email: 'a@example.com',
        fullName: 'Alice',
      },
    ]);

    const ctx = await requireAuth();
    expect(ctx).toEqual({
      userId: 'u-1',
      companyId: 'c-1',
      role: 'admin',
      email: 'a@example.com',
      fullName: 'Alice',
    });
  });

  it('throws 401 unauthenticated when no user in session', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(requireAuth()).rejects.toMatchObject({
      statusCode: 401,
      code: 'unauthenticated',
    });
  });

  it('self-heals: creates public.users row when auth user has no profile yet', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u-1', email: 'a@example.com' } },
    });
    // First select → empty (no profile).
    limitMock.mockResolvedValueOnce([]);
    // insert().values().returning() → newly-created row.
    returningMock.mockResolvedValueOnce([
      {
        id: 'u-1',
        email: 'a@example.com',
        fullName: 'a',
        role: 'owner',
        status: 'active',
        companyId: null,
      },
    ]);

    const ctx = await requireAuth();
    expect(ctx).toEqual({
      userId: 'u-1',
      companyId: null,
      role: 'owner',
      email: 'a@example.com',
      fullName: 'a',
    });
  });

  it('throws 403 account_disabled for deactivated users', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u-1', email: 'a@example.com' } },
    });
    limitMock.mockResolvedValue([
      {
        id: 'u-1',
        companyId: 'c-1',
        role: 'admin',
        status: 'deactivated',
        email: 'a@example.com',
        fullName: 'Alice',
      },
    ]);

    await expect(requireAuth()).rejects.toMatchObject({
      statusCode: 403,
      code: 'account_disabled',
    });
  });

  it('allows invited users through (pre-active state during onboarding)', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u-1', email: 'a@example.com' } },
    });
    limitMock.mockResolvedValue([
      {
        id: 'u-1',
        companyId: null,
        role: 'owner',
        status: 'invited',
        email: 'a@example.com',
        fullName: null,
      },
    ]);

    const ctx = await requireAuth();
    expect(ctx.companyId).toBeNull();
    expect(ctx.role).toBe('owner');
  });

  it('throws ApiAuthError instances specifically', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    try {
      await requireAuth();
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiAuthError);
    }
  });
});

describe('requireRole', () => {
  const base = (role: AuthContext['role']): AuthContext => ({
    userId: 'u-1',
    companyId: 'c-1',
    role,
    email: 'a@example.com',
    fullName: 'Alice',
  });

  it('passes when the user exceeds the minimum', () => {
    expect(() => requireRole(base('admin'), 'editor')).not.toThrow();
  });

  it('passes when the user matches the minimum exactly', () => {
    expect(() => requireRole(base('editor'), 'editor')).not.toThrow();
  });

  it('throws insufficient_role when below the minimum', () => {
    expect(() => requireRole(base('viewer'), 'editor')).toThrowError(
      /editor role or higher/,
    );
  });

  it('owner passes every gate', () => {
    expect(() => requireRole(base('owner'), 'owner')).not.toThrow();
    expect(() => requireRole(base('owner'), 'admin')).not.toThrow();
    expect(() => requireRole(base('owner'), 'editor')).not.toThrow();
    expect(() => requireRole(base('owner'), 'viewer')).not.toThrow();
  });
});

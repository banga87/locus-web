// Live-DB integration tests for /api/admin/oauth-connections (GET list)
// and /api/admin/oauth-connections/disconnect (POST).
//
// Ownership isolation is the critical invariant: seed two users in the
// same company, verify each sees only their own connections and can
// only revoke their own refresh tokens.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { eq, inArray, isNull, and } from 'drizzle-orm';

vi.mock('@/lib/api/auth', () => ({
  requireAuth: vi.fn(),
}));

import { db } from '@/db';
import {
  companies,
  oauthClients,
  oauthRefreshTokens,
  users,
} from '@/db/schema';
import { ApiAuthError } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { issueRefreshToken } from '@/lib/oauth/refresh';
import { GET } from '../route';
import { POST as DISCONNECT } from '../disconnect/route';

const USER_A_ID = '00000000-0000-0000-0000-00000000c0a1';
const USER_B_ID = '00000000-0000-0000-0000-00000000c0a2';

let companyId: string;
let clientAId: string;
let clientBId: string;

function mockAuthAs(userId: string | null) {
  const m = requireAuth as unknown as ReturnType<typeof vi.fn>;
  if (userId === null) {
    m.mockRejectedValueOnce(
      new ApiAuthError(401, 'unauthenticated', 'Sign in required.'),
    );
    return;
  }
  m.mockResolvedValueOnce({
    userId,
    companyId,
    role: 'owner',
    email: `${userId.slice(-6)}@example.com`,
    fullName: 'Test',
  });
}

function disconnectReq(body: unknown): Request {
  return new Request(
    'https://x.test/api/admin/oauth-connections/disconnect',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}

beforeAll(async () => {
  const [comp] = await db
    .insert(companies)
    .values({
      name: 'Connections Test',
      slug: `connections-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  companyId = comp.id;

  await db
    .insert(users)
    .values([
      {
        id: USER_A_ID,
        companyId,
        fullName: 'User A',
        email: 'a@example.com',
        status: 'active',
      },
      {
        id: USER_B_ID,
        companyId,
        fullName: 'User B',
        email: 'b@example.com',
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  const [cA] = await db
    .insert(oauthClients)
    .values({
      clientName: 'Claude Code',
      redirectUris: ['http://localhost:3000/cb'],
    })
    .returning();
  clientAId = cA.clientId;

  const [cB] = await db
    .insert(oauthClients)
    .values({
      clientName: 'Cursor',
      redirectUris: ['http://localhost:3000/cb'],
    })
    .returning();
  clientBId = cB.clientId;
});

afterAll(async () => {
  await db
    .delete(oauthRefreshTokens)
    .where(inArray(oauthRefreshTokens.clientId, [clientAId, clientBId]));
  await db
    .delete(oauthClients)
    .where(inArray(oauthClients.clientId, [clientAId, clientBId]));
  await db.delete(users).where(inArray(users.id, [USER_A_ID, USER_B_ID]));
  await db.delete(companies).where(eq(companies.id, companyId));
});

afterEach(async () => {
  (requireAuth as unknown as ReturnType<typeof vi.fn>).mockReset();
  // Clean refresh rows between tests so each test seeds from scratch.
  await db
    .delete(oauthRefreshTokens)
    .where(inArray(oauthRefreshTokens.clientId, [clientAId, clientBId]));
});

describe('GET /api/admin/oauth-connections', () => {
  it('returns connections for the current user only (ownership isolation)', async () => {
    await issueRefreshToken({ clientId: clientAId, userId: USER_A_ID, companyId });
    await issueRefreshToken({ clientId: clientBId, userId: USER_B_ID, companyId });

    mockAuthAs(USER_A_ID);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      clientId: string;
      clientName: string;
    }>;
    expect(body).toHaveLength(1);
    expect(body[0].clientId).toBe(clientAId);
    expect(body[0].clientName).toBe('Claude Code');
  });

  it('returns an empty array when the user has no connections', async () => {
    mockAuthAs(USER_A_ID);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('excludes refresh rows that are already revoked', async () => {
    await issueRefreshToken({ clientId: clientAId, userId: USER_A_ID, companyId });
    // Revoke it.
    await db
      .update(oauthRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthRefreshTokens.userId, USER_A_ID));

    mockAuthAs(USER_A_ID);
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('groups multiple refresh rows for the same client into one entry', async () => {
    await issueRefreshToken({ clientId: clientAId, userId: USER_A_ID, companyId });
    await issueRefreshToken({ clientId: clientAId, userId: USER_A_ID, companyId });
    await issueRefreshToken({ clientId: clientAId, userId: USER_A_ID, companyId });

    mockAuthAs(USER_A_ID);
    const res = await GET();
    const body = (await res.json()) as Array<{ clientId: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].clientId).toBe(clientAId);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthAs(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/oauth-connections/disconnect', () => {
  it("revokes the user's refresh rows for that client", async () => {
    await issueRefreshToken({ clientId: clientAId, userId: USER_A_ID, companyId });
    await issueRefreshToken({ clientId: clientAId, userId: USER_A_ID, companyId });

    mockAuthAs(USER_A_ID);
    const res = await DISCONNECT(disconnectReq({ client_id: clientAId }));
    expect(res.status).toBe(200);

    const active = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.userId, USER_A_ID),
          eq(oauthRefreshTokens.clientId, clientAId),
          isNull(oauthRefreshTokens.revokedAt),
        ),
      );
    expect(active).toHaveLength(0);
  });

  it("does NOT revoke another user's rows for the same client", async () => {
    await issueRefreshToken({ clientId: clientAId, userId: USER_A_ID, companyId });
    await issueRefreshToken({ clientId: clientAId, userId: USER_B_ID, companyId });

    mockAuthAs(USER_A_ID);
    const res = await DISCONNECT(disconnectReq({ client_id: clientAId }));
    expect(res.status).toBe(200);

    // User B's row must still be active.
    const bActive = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.userId, USER_B_ID),
          eq(oauthRefreshTokens.clientId, clientAId),
          isNull(oauthRefreshTokens.revokedAt),
        ),
      );
    expect(bActive).toHaveLength(1);
  });

  it('returns 400 when client_id is not a UUID', async () => {
    mockAuthAs(USER_A_ID);
    const res = await DISCONNECT(disconnectReq({ client_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_body');
  });

  it('returns 200 for an unknown client_id (idempotent no-op)', async () => {
    mockAuthAs(USER_A_ID);
    const res = await DISCONNECT(
      disconnectReq({ client_id: '11111111-1111-4111-8111-111111111111' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuthAs(null);
    const res = await DISCONNECT(disconnectReq({ client_id: clientAId }));
    expect(res.status).toBe(401);
  });
});

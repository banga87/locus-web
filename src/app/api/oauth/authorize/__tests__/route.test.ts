// GET /api/oauth/authorize — kicks off the consent flow.
// Live DB. Stubs @/lib/api/auth to avoid wiring up Supabase cookies.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

vi.mock('@/lib/api/auth', () => ({
  requireAuth: vi.fn(),
}));

import { db } from '@/db';
import {
  companies,
  oauthClients,
  oauthSessions,
  users,
} from '@/db/schema';
import { ApiAuthError } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { GET } from '../route';

const TEST_USER_ID = '00000000-0000-0000-0000-0000000a7201';

let clientId: string;
let companyId: string;
const insertedSessionRefs: string[] = [];

function mockAuth(ctx: Partial<Awaited<ReturnType<typeof requireAuth>>> | null) {
  const m = requireAuth as unknown as ReturnType<typeof vi.fn>;
  if (ctx === null) {
    m.mockRejectedValueOnce(
      new ApiAuthError(401, 'unauthenticated', 'Sign in required.'),
    );
    return;
  }
  m.mockResolvedValueOnce({
    userId: TEST_USER_ID,
    companyId,
    role: 'owner',
    email: 't@example.com',
    fullName: 'T',
    ...ctx,
  });
}

function makeUrl(params: Record<string, string>): URL {
  const url = new URL('https://x.test/api/oauth/authorize');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

beforeAll(async () => {
  const [comp] = await db
    .insert(companies)
    .values({
      name: 'Authorize Test',
      slug: `authorize-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  companyId = comp.id;

  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      companyId,
      fullName: 'Test',
      email: 't@example.com',
      status: 'active',
    })
    .onConflictDoNothing();

  const [c] = await db
    .insert(oauthClients)
    .values({
      clientName: 'Authorize Test',
      redirectUris: ['http://localhost:3000/cb', 'http://localhost:4000/cb'],
    })
    .returning();
  clientId = c.clientId;
});

afterAll(async () => {
  if (insertedSessionRefs.length) {
    await db
      .delete(oauthSessions)
      .where(inArray(oauthSessions.sessionRef, insertedSessionRefs));
  }
  await db.delete(oauthClients).where(inArray(oauthClients.clientId, [clientId]));
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.delete(companies).where(eq(companies.id, companyId));
});

afterEach(() => {
  (requireAuth as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('GET /api/oauth/authorize', () => {
  it('happy path: redirects to /auth/mcp with a session ref', async () => {
    mockAuth({});
    const url = makeUrl({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'http://localhost:3000/cb',
      code_challenge: 'abcd',
      code_challenge_method: 'S256',
      state: 'xyz',
    });
    const res = await GET(new Request(url));
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toMatch(/\/auth\/mcp\?session=[0-9a-f]{32}$/);
    const sessionRef = new URL(location, url).searchParams.get('session')!;
    insertedSessionRefs.push(sessionRef);

    // Session row was persisted with the right fields.
    const [row] = await db
      .select()
      .from(oauthSessions)
      .where(eq(oauthSessions.sessionRef, sessionRef))
      .limit(1);
    expect(row.clientId).toBe(clientId);
    expect(row.redirectUri).toBe('http://localhost:3000/cb');
    expect(row.codeChallenge).toBe('abcd');
    expect(row.state).toBe('xyz');
  });

  it('redirects unauthenticated users to /login with a next query', async () => {
    mockAuth(null);
    const url = makeUrl({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'http://localhost:3000/cb',
      code_challenge: 'abcd',
      code_challenge_method: 'S256',
    });
    const res = await GET(new Request(url));
    expect(res.status).toBe(307);
    const location = res.headers.get('location')!;
    expect(location).toContain('/login?next=');
    expect(decodeURIComponent(location.split('next=')[1])).toBe(url.toString());
  });

  it('returns 400 HTML when response_type is not "code"', async () => {
    mockAuth({});
    const res = await GET(
      new Request(
        makeUrl({
          response_type: 'token',
          client_id: clientId,
          redirect_uri: 'http://localhost:3000/cb',
          code_challenge: 'abcd',
          code_challenge_method: 'S256',
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('returns 400 HTML when code_challenge_method is not S256', async () => {
    mockAuth({});
    const res = await GET(
      new Request(
        makeUrl({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: 'http://localhost:3000/cb',
          code_challenge: 'abcd',
          code_challenge_method: 'plain',
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('returns 400 HTML when required params are missing', async () => {
    mockAuth({});
    const res = await GET(
      new Request(
        makeUrl({
          response_type: 'code',
          client_id: clientId,
          // no redirect_uri, no code_challenge
          code_challenge_method: 'S256',
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('returns 400 HTML for an unknown client_id (no redirect)', async () => {
    mockAuth({});
    const res = await GET(
      new Request(
        makeUrl({
          response_type: 'code',
          client_id: '00000000-0000-0000-0000-000000000000',
          redirect_uri: 'http://localhost:3000/cb',
          code_challenge: 'abcd',
          code_challenge_method: 'S256',
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('location')).toBeNull();
  });

  it('returns 400 HTML when redirect_uri is not in the client allowlist', async () => {
    mockAuth({});
    const res = await GET(
      new Request(
        makeUrl({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: 'http://localhost:9999/cb',
          code_challenge: 'abcd',
          code_challenge_method: 'S256',
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('location')).toBeNull();
  });

  it('returns 400 HTML when redirect_uri is not localhost (belt-and-braces)', async () => {
    // Seed a client whose registered URI is non-localhost, then try to use
    // it — localhost validator should still reject at the authorize step.
    const [evil] = await db
      .insert(oauthClients)
      .values({
        clientName: 'Evil (manual insert)',
        redirectUris: ['https://evil.example.com/cb'],
      })
      .returning();
    try {
      mockAuth({});
      const res = await GET(
        new Request(
          makeUrl({
            response_type: 'code',
            client_id: evil.clientId,
            redirect_uri: 'https://evil.example.com/cb',
            code_challenge: 'abcd',
            code_challenge_method: 'S256',
          }),
        ),
      );
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      expect(res.headers.get('location')).toBeNull();
    } finally {
      await db
        .delete(oauthClients)
        .where(eq(oauthClients.clientId, evil.clientId));
    }
  });
});

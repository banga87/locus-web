// POST /api/oauth/authorize/deny — the user clicked "Deny". We bounce
// the browser back to the client's redirect_uri with `error=access_denied`.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

vi.mock('@/lib/api/auth', () => ({
  requireAuth: vi.fn(),
}));

import { db } from '@/db';
import { companies, oauthClients, oauthSessions, users } from '@/db/schema';
import { ApiAuthError } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { createSession } from '@/lib/oauth/sessions';
import { POST } from '../route';

const TEST_USER_ID = '00000000-0000-0000-0000-0000000a7203';

let clientId: string;
let companyId: string;

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

function formReq(body: Record<string, string>): Request {
  const form = new URLSearchParams(body);
  return new Request('https://x.test/api/oauth/authorize/deny', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
}

beforeAll(async () => {
  const [comp] = await db
    .insert(companies)
    .values({
      name: 'Deny Test',
      slug: `deny-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      clientName: 'Deny Test',
      redirectUris: ['http://localhost:3000/cb'],
    })
    .returning();
  clientId = c.clientId;
});

afterAll(async () => {
  await db.delete(oauthSessions).where(eq(oauthSessions.clientId, clientId));
  await db.delete(oauthClients).where(inArray(oauthClients.clientId, [clientId]));
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.delete(companies).where(eq(companies.id, companyId));
});

afterEach(() => {
  (requireAuth as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('POST /api/oauth/authorize/deny', () => {
  it('redirects to redirect_uri with error=access_denied and state', async () => {
    mockAuth({});
    const session = await createSession({
      clientId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: 'abcd',
      state: 'xyz',
    });
    const res = await POST(formReq({ session_ref: session.sessionRef }));
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc).toBe(
      'http://localhost:3000/cb?error=access_denied&state=xyz',
    );

    // Session was deleted.
    const [row] = await db
      .select()
      .from(oauthSessions)
      .where(eq(oauthSessions.sessionRef, session.sessionRef))
      .limit(1);
    expect(row).toBeUndefined();
  });

  it('omits state when the session had none', async () => {
    mockAuth({});
    const session = await createSession({
      clientId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: 'abcd',
      state: null,
    });
    const res = await POST(formReq({ session_ref: session.sessionRef }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/cb?error=access_denied',
    );
  });

  it('preserves existing query string on redirect_uri with &', async () => {
    mockAuth({});
    const session = await createSession({
      clientId,
      redirectUri: 'http://localhost:3000/cb?foo=1',
      codeChallenge: 'abcd',
      state: null,
    });
    const res = await POST(formReq({ session_ref: session.sessionRef }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/cb?foo=1&error=access_denied',
    );
  });

  it('returns 400 HTML when the session is missing/expired', async () => {
    mockAuth({});
    const res = await POST(formReq({ session_ref: 'does-not-exist' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('returns 401 when unauthenticated', async () => {
    mockAuth(null);
    const res = await POST(formReq({ session_ref: 'anything' }));
    expect(res.status).toBe(401);
  });
});

// @vitest-environment node
// jose's webapi realm check fails under jsdom (see src/lib/oauth/jwt.test.ts)
// so this file is pinned to node.
//
// Deny + error integration tests for the MCP-IN OAuth flow.
//
// Scenarios:
//   1. Deny path
//   2. Expired session at approve
//   3. Wrong PKCE verifier at token exchange
//   4. Wrong redirect_uri at token exchange (adapted — see scenario notes)
//   5. Double code redemption
//   6. Refresh token replay triggers chain-kill
//   7. Tampered JWT at /api/mcp

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';

vi.mock('@/lib/api/auth', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@vercel/functions', () => ({
  waitUntil: (_p: Promise<unknown>) => undefined,
}));
vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

import { db } from '@/db';
import {
  companies,
  oauthClients,
  oauthCodes,
  oauthRefreshTokens,
  oauthSessions,
  users,
} from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { generateCode } from '@/lib/oauth/codes';

import { POST as POST_register } from '../register/route';
import { GET as GET_authorize } from '../authorize/route';
import { POST as POST_approve } from '../authorize/approve/route';
import { POST as POST_deny } from '../authorize/deny/route';
import { POST as POST_token } from '../token/route';
import { POST as POST_mcp } from '@/app/api/mcp/route';

const TEST_USER_ID = '00000000-0000-0000-0000-0000000e2e02';
const REDIRECT_URI = 'http://localhost:33418/cb';

let companyId: string;
const createdClientIds: string[] = [];

// --- helpers -----------------------------------------------------------

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerClient(): Promise<string> {
  const reg = await POST_register(
    new Request('https://x/api/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Errors Test Client',
        redirect_uris: [REDIRECT_URI],
      }),
    }),
  );
  expect(reg.status).toBe(201);
  const { client_id } = (await reg.json()) as { client_id: string };
  createdClientIds.push(client_id);
  return client_id;
}

async function startSession(
  clientId: string,
  state = 'st',
): Promise<{ sessionRef: string; verifier: string }> {
  const { verifier, challenge } = pkcePair();
  const url = new URL('https://x/api/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  const res = await GET_authorize(new Request(url));
  expect(res.status).toBe(302);
  const location = res.headers.get('location')!;
  const sessionRef = new URL(location, 'https://x').searchParams.get(
    'session',
  )!;
  return { sessionRef, verifier };
}

async function approveAndExtractCode(sessionRef: string): Promise<string> {
  const form = new FormData();
  form.set('session_ref', sessionRef);
  const res = await POST_approve(
    new Request('https://x/api/oauth/authorize/approve', {
      method: 'POST',
      body: form,
    }),
  );
  expect(res.status).toBe(200);
  const html = await res.text();
  const m = /[?&](?:amp;)?code=([^&"'\s]+)/.exec(html);
  expect(m).not.toBeNull();
  return decodeURIComponent(m![1]);
}

async function fullFlowTokens(
  clientId: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const { sessionRef, verifier } = await startSession(clientId);
  const code = await approveAndExtractCode(sessionRef);
  const res = await POST_token(
    new Request('https://x/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
      }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
  };
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

// --- lifecycle ---------------------------------------------------------

beforeAll(async () => {
  process.env.MCP_OAUTH_JWT_SECRET =
    'test-secret-at-least-32-bytes-long-xxxxxxxxxxxxxx';

  const [comp] = await db
    .insert(companies)
    .values({
      name: 'Errors OAuth Test',
      slug: `errors-oauth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  companyId = comp.id;

  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      companyId,
      fullName: 'T',
      email: 'errors@example.com',
      status: 'active',
    })
    .onConflictDoNothing();

  (requireAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: TEST_USER_ID,
    companyId,
    role: 'owner',
    email: 'errors@example.com',
    fullName: 'T',
  });
});

afterAll(async () => {
  await db.delete(oauthCodes).where(eq(oauthCodes.userId, TEST_USER_ID));
  await db
    .delete(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.userId, TEST_USER_ID));
  if (createdClientIds.length) {
    await db
      .delete(oauthSessions)
      .where(inArray(oauthSessions.clientId, createdClientIds));
    await db
      .delete(oauthClients)
      .where(inArray(oauthClients.clientId, createdClientIds));
  }
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
  await db.delete(companies).where(eq(companies.id, companyId));
});

afterEach(() => {
  // Don't reset mocks — we use mockResolvedValue (not Once) so requireAuth
  // stays stubbed across tests.
});

// --- scenarios ---------------------------------------------------------

describe('OAuth integration — error paths', () => {
  it('1. deny path: 302 to redirect_uri with access_denied; no code minted', async () => {
    const clientId = await registerClient();
    const { sessionRef } = await startSession(clientId, 'denyme');

    const codesBefore = await db
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.clientId, clientId));
    expect(codesBefore.length).toBe(0);

    const form = new FormData();
    form.set('session_ref', sessionRef);
    const res = await POST_deny(
      new Request('https://x/api/oauth/authorize/deny', {
        method: 'POST',
        body: form,
      }),
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc).toBe(
      `${REDIRECT_URI}?error=access_denied&state=denyme`,
    );

    // No code was minted for this client.
    const codesAfter = await db
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.clientId, clientId));
    expect(codesAfter.length).toBe(0);
  });

  it('2. expired session at approve: returns expired HTML; no code issued', async () => {
    const clientId = await registerClient();
    const { sessionRef } = await startSession(clientId);

    // Force the session to look expired.
    await db
      .update(oauthSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthSessions.sessionRef, sessionRef));

    const form = new FormData();
    form.set('session_ref', sessionRef);
    const res = await POST_approve(
      new Request('https://x/api/oauth/authorize/approve', {
        method: 'POST',
        body: form,
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html.toLowerCase()).toContain('expired');

    // No code was minted.
    const codes = await db
      .select()
      .from(oauthCodes)
      .where(eq(oauthCodes.clientId, clientId));
    expect(codes.length).toBe(0);
  });

  it('3. wrong PKCE verifier at token exchange: 400 invalid_grant', async () => {
    const clientId = await registerClient();
    const { sessionRef } = await startSession(clientId);
    const code = await approveAndExtractCode(sessionRef);

    const res = await POST_token(
      new Request('https://x/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          code_verifier: 'wrong-verifier-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('4. wrong redirect_uri at token exchange: 400 invalid_grant', async () => {
    // The authorize route pre-validates redirect_uri against the client's
    // registered list (see src/app/api/oauth/authorize/route.ts step 5),
    // so a mismatch can't be smuggled through public handlers. To exercise
    // the token endpoint's own redirect_uri check we mint a code directly
    // via the codes repo with one URI, then POST /token with a different
    // one — same code path consumeCode() walks for any real-world mismatch.
    const clientId = await registerClient();
    const { verifier, challenge } = pkcePair();
    const { code } = await generateCode({
      clientId,
      userId: TEST_USER_ID,
      companyId,
      redirectUri: REDIRECT_URI,
      codeChallenge: challenge,
    });

    const res = await POST_token(
      new Request('https://x/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'http://localhost:9999/cb',
          client_id: clientId,
          code_verifier: verifier,
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('5. double code redemption: second exchange returns 400 invalid_grant', async () => {
    const clientId = await registerClient();
    const { sessionRef, verifier } = await startSession(clientId);
    const code = await approveAndExtractCode(sessionRef);

    const formBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    });

    const first = await POST_token(
      new Request('https://x/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      }),
    );
    expect(first.status).toBe(200);

    const second = await POST_token(
      new Request('https://x/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      }),
    );
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ error: 'invalid_grant' });
  });

  it('6. refresh-token replay triggers chain-kill across the family', { timeout: 20000 }, async () => {
    const clientId = await registerClient();
    const { refreshToken: t0 } = await fullFlowTokens(clientId);

    // Rotate once: t0 -> t1.
    const rotateRes = await POST_token(
      new Request('https://x/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: t0,
          client_id: clientId,
        }),
      }),
    );
    expect(rotateRes.status).toBe(200);
    const { refresh_token: t1 } = (await rotateRes.json()) as {
      refresh_token: string;
    };

    // Replay the OLD refresh token -> chain-kill.
    const replay = await POST_token(
      new Request('https://x/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: t0,
          client_id: clientId,
        }),
      }),
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: 'invalid_grant' });

    // Every refresh row for (user, client) must now be revoked, including t1.
    const activeRows = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.userId, TEST_USER_ID),
          eq(oauthRefreshTokens.clientId, clientId),
          isNull(oauthRefreshTokens.revokedAt),
        ),
      );
    expect(activeRows.length).toBe(0);

    // Sanity: t1 itself can no longer be used.
    const t1Try = await POST_token(
      new Request('https://x/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: t1,
          client_id: clientId,
        }),
      }),
    );
    expect(t1Try.status).toBe(400);
    expect(await t1Try.json()).toEqual({ error: 'invalid_grant' });
  });

  it('7. tampered JWT at /api/mcp returns 401 with WWW-Authenticate', { timeout: 20000 }, async () => {
    const clientId = await registerClient();
    const { accessToken } = await fullFlowTokens(clientId);

    // Mutate the signature segment (last 2 chars) to invalidate the JWT
    // while keeping it well-formed enough to reach the verifier.
    const tampered = accessToken.slice(0, -2) + 'xx';

    const res = await POST_mcp(
      new Request('https://locus.app/api/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tampered}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      }),
    );
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get('www-authenticate');
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toContain('Bearer');
    expect(wwwAuth).toContain('resource_metadata');
  });
});

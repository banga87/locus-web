// @vitest-environment node
// jose's webapi realm check fails under jsdom (see src/lib/oauth/jwt.test.ts)
// so this file is pinned to node.
//
// End-to-end happy-path integration test for the MCP-IN OAuth flow.
//
// Walks every public route in order:
//   POST /api/oauth/register
//     -> GET  /api/oauth/authorize
//     -> POST /api/oauth/authorize/approve
//     -> POST /api/oauth/token (authorization_code)
//     -> POST /api/oauth/token (refresh_token)
//     -> POST /api/mcp        (with the rotated access token)
//
// This is the single most important integration test for this feature.
// If it goes red we have broken at least one route's wire-up.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { decodeJwt } from 'jose';

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

import { POST as POST_register } from '../register/route';
import { GET as GET_authorize } from '../authorize/route';
import { POST as POST_approve } from '../authorize/approve/route';
import { POST as POST_token } from '../token/route';
import { POST as POST_mcp } from '@/app/api/mcp/route';

const TEST_USER_ID = '00000000-0000-0000-0000-0000000e2e01';
const REDIRECT_URI = 'http://localhost:33418/cb';

let companyId: string;
const createdClientIds: string[] = [];

beforeAll(async () => {
  process.env.MCP_OAUTH_JWT_SECRET =
    'test-secret-at-least-32-bytes-long-xxxxxxxxxxxxxx';

  const [comp] = await db
    .insert(companies)
    .values({
      name: 'E2E OAuth Test',
      slug: `e2e-oauth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  companyId = comp.id;

  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      companyId,
      fullName: 'T',
      email: 'e2e@example.com',
      status: 'active',
    })
    .onConflictDoNothing();

  (requireAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: TEST_USER_ID,
    companyId,
    role: 'owner',
    email: 'e2e@example.com',
    fullName: 'T',
  });
});

afterAll(async () => {
  // Idempotent, scoped cleanup. Wipe anything keyed to the test user / company.
  await db
    .delete(oauthCodes)
    .where(eq(oauthCodes.userId, TEST_USER_ID));
  await db
    .delete(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.userId, TEST_USER_ID));
  if (createdClientIds.length) {
    // oauth_sessions FK-cascades on client_id; delete them explicitly anyway
    // for clarity in case the FK ever changes.
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

describe('OAuth end-to-end happy path', () => {
  it('walks the full OAuth flow end-to-end', { timeout: 20000 }, async () => {
    // 1. Register a client via DCR.
    const reg = await POST_register(
      new Request('https://x/api/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'E2E Test Client',
          redirect_uris: [REDIRECT_URI],
        }),
      }),
    );
    expect(reg.status).toBe(201);
    const regBody = (await reg.json()) as { client_id: string };
    const clientId = regBody.client_id;
    expect(clientId).toMatch(/^[0-9a-f-]{36}$/);
    createdClientIds.push(clientId);

    // 2. GET /authorize (the user is "logged in" via the requireAuth mock).
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const authorizeUrl = new URL('https://x/api/oauth/authorize');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', 'xyz-state');

    const authRes = await GET_authorize(new Request(authorizeUrl));
    expect(authRes.status).toBe(302);
    const location = authRes.headers.get('location')!;
    expect(location).toBeTruthy();
    const sessionRef = new URL(location, 'https://x').searchParams.get(
      'session',
    )!;
    expect(sessionRef).toBeTruthy();

    // 3. POST /authorize/approve — issues the code and renders success HTML.
    const approveForm = new FormData();
    approveForm.set('session_ref', sessionRef);
    const approveRes = await POST_approve(
      new Request('https://x/api/oauth/authorize/approve', {
        method: 'POST',
        body: approveForm,
      }),
    );
    expect(approveRes.status).toBe(200);
    const html = await approveRes.text();
    // The success page HTML-escapes `&` to `&amp;`, so match either form.
    const m = /[?&](?:amp;)?code=([^&"'\s]+)/.exec(html);
    expect(m).not.toBeNull();
    const code = decodeURIComponent(m![1]);
    expect(html).toContain('state=xyz-state');

    // 4. Token exchange — authorization_code grant.
    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    });
    const tokenRes = await POST_token(
      new Request('https://x/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: tokenForm,
      }),
    );
    expect(tokenRes.status).toBe(200);
    const pair = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
    };
    expect(pair.token_type).toBe('Bearer');
    expect(pair.expires_in).toBe(3600);
    expect(pair.access_token).toBeTruthy();
    expect(pair.refresh_token).toBeTruthy();

    // 5. Decode the access token and assert claims.
    const claims = decodeJwt(pair.access_token);
    expect(claims.sub).toBe(TEST_USER_ID);
    expect(claims.cid).toBe(companyId);
    expect(claims.cli).toBe(clientId);
    expect(claims.iss).toBe('https://locus.app');
    expect(claims.aud).toBe('https://locus.app/api/mcp');

    // 6. Refresh — rotation issues a new pair.
    const refreshForm = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: pair.refresh_token,
      client_id: clientId,
    });
    const refreshRes = await POST_token(
      new Request('https://x/api/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: refreshForm,
      }),
    );
    expect(refreshRes.status).toBe(200);
    const pair2 = (await refreshRes.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(pair2.access_token).not.toBe(pair.access_token);
    expect(pair2.refresh_token).not.toBe(pair.refresh_token);

    // 7. Hit /api/mcp with the rotated access token. We don't pin the
    // exact body (depends on the MCP transport's response shape); we
    // only assert that auth succeeded — i.e. it is NOT a 401.
    const mcpRes = await POST_mcp(
      new Request('https://locus.app/api/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${pair2.access_token}`,
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
    expect(mcpRes.status).not.toBe(401);
  });
});

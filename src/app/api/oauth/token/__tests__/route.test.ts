// @vitest-environment node
// jose's webapi realm check fails under jsdom (see src/lib/oauth/jwt.test.ts
// for the gory details) — pin this file to node.
//
// POST /api/oauth/token — covers both grant types dispatched by the route:
//   - authorization_code (Task 18)
//   - refresh_token (Task 19)
// Uses the live DB; seeds a company + user + client, wipes oauth_codes and
// oauth_refresh_tokens at the end.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import { db } from '@/db';
import {
  companies,
  oauthClients,
  oauthCodes,
  oauthRefreshTokens,
  users,
} from '@/db/schema';
import { generateCode } from '@/lib/oauth/codes';
import { issueRefreshToken } from '@/lib/oauth/refresh';
import { POST } from '../route';

let clientId: string;
let userId: string;
let companyId: string;

beforeAll(async () => {
  process.env.MCP_OAUTH_JWT_SECRET =
    'test-secret-at-least-32-bytes-long-xxxxxxxxxxxxxx';

  const [comp] = await db
    .insert(companies)
    .values({
      name: 'Token Route Test',
      slug: `token-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  companyId = comp.id;

  userId = '00000000-0000-0000-0000-0000000000ae';
  await db
    .insert(users)
    .values({
      id: userId,
      companyId,
      fullName: 'Token Test',
      email: 'token@example.com',
      status: 'active',
    })
    .onConflictDoNothing();

  const [c] = await db
    .insert(oauthClients)
    .values({
      clientName: 'Token Route Test',
      redirectUris: ['http://localhost:3000/cb'],
    })
    .returning();
  clientId = c.clientId;
});

afterAll(async () => {
  // Scope cleanup to our seeded user/client so parallel test files using
  // the same tables (e.g. src/lib/oauth/__tests__/refresh.test.ts) don't
  // get their in-flight rows wiped out from under them.
  await db.delete(oauthCodes).where(eq(oauthCodes.userId, userId));
  await db.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, userId));
  await db.delete(oauthClients).where(inArray(oauthClients.clientId, [clientId]));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(companies).where(eq(companies.id, companyId));
});

// --- helpers -----------------------------------------------------------

const REDIRECT = 'http://localhost:3000/cb';

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function formRequest(body: Record<string, string>): Request {
  return new Request('https://x/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

async function mintCode(): Promise<{ code: string; verifier: string }> {
  const { verifier, challenge } = pkcePair();
  const { code } = await generateCode({
    clientId,
    userId,
    companyId,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
  });
  return { code, verifier };
}

// --- authorization_code grant (Task 18) --------------------------------

describe('POST /api/oauth/token — authorization_code grant', () => {
  it('happy path: 200 with access_token, refresh_token, Bearer, expires_in, no-store', async () => {
    const { code, verifier } = await mintCode();
    const res = await POST(
      formRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
    };
    expect(typeof body.access_token).toBe('string');
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    expect(typeof body.refresh_token).toBe('string');
    expect(body.refresh_token.length).toBeGreaterThan(0);
  });

  it('access_token claims are signed with the expected values', async () => {
    const { code, verifier } = await mintCode();
    const res = await POST(
      formRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    );
    const body = (await res.json()) as { access_token: string };
    const claims = decodeJwt(body.access_token);
    expect(claims.sub).toBe(userId);
    expect(claims.cid).toBe(companyId);
    expect(claims.cli).toBe(clientId);
    expect(claims.scopes).toEqual(['read']);
    expect(claims.iss).toBe('https://locus.app');
    expect(claims.aud).toBe('https://locus.app/api/mcp');
  });

  it('rejects wrong code_verifier with invalid_grant', async () => {
    const { code } = await mintCode();
    const res = await POST(
      formRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: 'wrong-verifier-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects wrong redirect_uri with invalid_grant', async () => {
    const { code, verifier } = await mintCode();
    const res = await POST(
      formRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:9999/cb',
        client_id: clientId,
        code_verifier: verifier,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects expired code with invalid_grant', async () => {
    const { verifier, challenge } = pkcePair();
    const code = randomBytes(32).toString('hex');
    const codeHash = createHash('sha256').update(code).digest('hex');
    await db.insert(oauthCodes).values({
      codeHash,
      clientId,
      userId,
      companyId,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await POST(
      formRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects unknown code with invalid_grant', async () => {
    const { verifier } = pkcePair();
    const res = await POST(
      formRequest({
        grant_type: 'authorization_code',
        code: randomBytes(32).toString('hex'),
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects missing code field with invalid_request', async () => {
    const res = await POST(
      formRequest({
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: 'v',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });

  it('rejects double-redemption of the same code with invalid_grant', async () => {
    const { code, verifier } = await mintCode();
    const first = await POST(
      formRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    );
    expect(first.status).toBe(200);
    const second = await POST(
      formRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    );
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ error: 'invalid_grant' });
  });
});

// --- refresh_token grant (Task 19) -------------------------------------

describe('POST /api/oauth/token — refresh_token grant', () => {
  it('happy rotation: returns new access_token + new refresh_token', async () => {
    const { refreshToken } = await issueRefreshToken({
      clientId,
      userId,
      companyId,
    });
    const res = await POST(
      formRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = (await res.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
    };
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(3600);
    expect(body.refresh_token).not.toBe(refreshToken);

    const claims = decodeJwt(body.access_token);
    expect(claims.sub).toBe(userId);
    expect(claims.cid).toBe(companyId);
    expect(claims.cli).toBe(clientId);
    expect(claims.scopes).toEqual(['read']);

    await db.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, userId));
  });

  it('rejects reuse of the original refresh token with invalid_grant (chain-kill)', async () => {
    const { refreshToken: t0 } = await issueRefreshToken({
      clientId,
      userId,
      companyId,
    });
    // First rotation succeeds and revokes t0.
    const first = await POST(
      formRequest({
        grant_type: 'refresh_token',
        refresh_token: t0,
        client_id: clientId,
      }),
    );
    expect(first.status).toBe(200);
    const { refresh_token: t1 } = (await first.json()) as {
      refresh_token: string;
    };

    // Replay of t0 → chain-kill, invalid_grant.
    const replay = await POST(
      formRequest({
        grant_type: 'refresh_token',
        refresh_token: t0,
        client_id: clientId,
      }),
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: 'invalid_grant' });

    // After chain-kill, t1 is also revoked → invalid_grant.
    const newerTry = await POST(
      formRequest({
        grant_type: 'refresh_token',
        refresh_token: t1,
        client_id: clientId,
      }),
    );
    expect(newerTry.status).toBe(400);
    expect(await newerTry.json()).toEqual({ error: 'invalid_grant' });

    await db.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, userId));
  });

  it('rejects unknown refresh_token with invalid_grant', async () => {
    const res = await POST(
      formRequest({
        grant_type: 'refresh_token',
        refresh_token: 'not-a-real-token',
        client_id: clientId,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
  });

  it('rejects expired refresh_token with invalid_grant', async () => {
    const token = 'expired-' + Date.now() + '-' + randomBytes(8).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await db.insert(oauthRefreshTokens).values({
      tokenHash,
      clientId,
      userId,
      companyId,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await POST(
      formRequest({
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: clientId,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant' });
    await db.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, userId));
  });

  it('rejects missing refresh_token with invalid_request', async () => {
    const res = await POST(
      formRequest({ grant_type: 'refresh_token', client_id: clientId }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });
});

// --- unsupported / missing grant_type ----------------------------------

describe('POST /api/oauth/token — unsupported grant', () => {
  it('rejects grant_type=password with unsupported_grant_type', async () => {
    const res = await POST(
      formRequest({
        grant_type: 'password',
        username: 'u',
        password: 'p',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unsupported_grant_type' });
  });

  it('rejects missing grant_type with unsupported_grant_type', async () => {
    const res = await POST(formRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unsupported_grant_type' });
  });
});

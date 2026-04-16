// @vitest-environment node
// MCP auth tests — exercise authenticateAgentToken against the live DB.
//
// Each test creates a scratch company + token via the real token
// primitives. We spy on `logAuthEvent` to confirm the audit trail is
// complete on every outcome, and tear down inserted rows in afterAll.
//
// Pinned to the node vitest environment because the OAuth path calls
// jose's SignJWT/jwtVerify, and jose's webapi build does `instanceof
// Uint8Array` checks against its own realm (jsdom fails the check).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

vi.mock('@/lib/audit/helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit/helpers')>(
    '@/lib/audit/helpers',
  );
  return {
    ...actual,
    logAuthEvent: vi.fn(),
  };
});

import { db } from '@/db';
import { agentAccessTokens, companies } from '@/db/schema';
import { createToken, revokeToken } from '@/lib/auth/tokens';
import { logAuthEvent } from '@/lib/audit/helpers';
import { signAccessToken } from '@/lib/oauth/jwt';

import { authenticateAgentToken } from '../auth';

const TEST_USER_ID = '00000000-0000-0000-0000-00000000bbbb';

let TEST_COMPANY_ID: string;
const insertedTokenIds: string[] = [];

beforeAll(async () => {
  process.env.MCP_OAUTH_JWT_SECRET =
    process.env.MCP_OAUTH_JWT_SECRET ??
    'test-secret-at-least-32-bytes-long-xxxxxxxxxxxxxx';

  const [company] = await db
    .insert(companies)
    .values({
      name: 'MCP Auth Test Co',
      slug: `mcp-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  TEST_COMPANY_ID = company.id;
});

afterAll(async () => {
  if (insertedTokenIds.length > 0) {
    await db
      .delete(agentAccessTokens)
      .where(inArray(agentAccessTokens.id, insertedTokenIds));
  }
  if (TEST_COMPANY_ID) {
    await db.delete(companies).where(eq(companies.id, TEST_COMPANY_ID));
  }
});

beforeEach(() => {
  vi.mocked(logAuthEvent).mockClear();
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/mcp', {
    method: 'POST',
    headers,
  });
}

describe('authenticateAgentToken', () => {
  it('returns ok:true with token metadata when the token is valid', async () => {
    const { token, record } = await createToken({
      companyId: TEST_COMPANY_ID,
      name: 'MCP auth — valid',
      createdBy: TEST_USER_ID,
    });
    insertedTokenIds.push(record.id);

    const result = await authenticateAgentToken(
      makeRequest({ Authorization: `Bearer ${token}` }),
    );

    expect(result).toEqual({
      ok: true,
      tokenId: record.id,
      companyId: TEST_COMPANY_ID,
      userId: null,
      scopes: ['read'],
      tokenType: 'pat',
    });

    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'token.used',
        actorType: 'agent_token',
        actorId: record.id,
        companyId: TEST_COMPANY_ID,
        tokenId: record.id,
      }),
    );
  });

  it('returns missing_token when Authorization header is absent', async () => {
    const result = await authenticateAgentToken(makeRequest({}));

    expect(result).toEqual({
      ok: false,
      code: 'missing_token',
      message: expect.any(String),
    });

    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'auth.failed',
        details: expect.objectContaining({ reason: 'missing_token' }),
      }),
    );
  });

  it('returns missing_token for a non-Bearer Authorization scheme', async () => {
    const result = await authenticateAgentToken(
      makeRequest({ Authorization: 'Basic dXNlcjpwYXNz' }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('missing_token');
    }
  });

  it('accepts lowercase "authorization" header', async () => {
    const { token, record } = await createToken({
      companyId: TEST_COMPANY_ID,
      name: 'MCP auth — lowercase header',
      createdBy: TEST_USER_ID,
    });
    insertedTokenIds.push(record.id);

    const result = await authenticateAgentToken(
      makeRequest({ authorization: `Bearer ${token}` }),
    );

    expect(result.ok).toBe(true);
  });

  it('returns invalid_token for a bogus token', async () => {
    const result = await authenticateAgentToken(
      makeRequest({
        Authorization:
          'Bearer lat_live_bogusbogusbogusbogusbogusbogusbogusbogusbogusbogus',
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: 'invalid_token',
      message: expect.any(String),
    });

    expect(logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'auth.failed',
        details: expect.objectContaining({
          reason: 'invalid_credentials',
          tokenPrefix: 'lat_live_bog',
        }),
      }),
    );
  });

  it('returns invalid_token for a revoked token (validateToken excludes revoked rows)', async () => {
    const { token, record } = await createToken({
      companyId: TEST_COMPANY_ID,
      name: 'MCP auth — revoked',
      createdBy: TEST_USER_ID,
    });
    insertedTokenIds.push(record.id);

    await revokeToken(record.id);

    const result = await authenticateAgentToken(
      makeRequest({ Authorization: `Bearer ${token}` }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_token');
    }
  });
});

describe('authenticateAgentToken — OAuth path', () => {
  it('accepts a valid JWT and returns oauth token context', async () => {
    const jwt = await signAccessToken({
      userId: '11111111-1111-1111-1111-111111111111',
      companyId: '22222222-2222-2222-2222-222222222222',
      clientId: '33333333-3333-3333-3333-333333333333',
      scopes: ['read'],
    });
    const r = await authenticateAgentToken(
      makeRequest({ Authorization: `Bearer ${jwt}` }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokenType).toBe('oauth');
      expect(r.userId).toBe('11111111-1111-1111-1111-111111111111');
      expect(r.companyId).toBe('22222222-2222-2222-2222-222222222222');
      expect(r.tokenId).toBe('33333333-3333-3333-3333-333333333333');
      expect(r.scopes).toEqual(['read']);
    }
  });

  it('rejects a JWT with tampered signature', async () => {
    const jwt = await signAccessToken({
      userId: 'u',
      companyId: 'c',
      clientId: 'cl',
      scopes: [],
    });
    const tampered = jwt.slice(0, -2) + 'xx';
    const r = await authenticateAgentToken(
      makeRequest({ Authorization: `Bearer ${tampered}` }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_token');
  });

  it('rejects a garbage token that is neither PAT nor JWT', async () => {
    const r = await authenticateAgentToken(
      makeRequest({ Authorization: 'Bearer nonsense' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_token');
  });
});

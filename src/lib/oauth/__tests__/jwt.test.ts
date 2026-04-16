// @vitest-environment node
// jose's webapi build does `instanceof Uint8Array` checks against its
// own realm. Under jsdom the global `Uint8Array` is a different realm,
// so `TextEncoder#encode()` results (used internally by SignJWT) fail
// those checks and sign() throws "payload must be an instance of
// Uint8Array". Pinning this file to the node environment sidesteps the
// realm mismatch without affecting other test files.

import { describe, expect, it, beforeAll } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../jwt';

beforeAll(() => {
  process.env.MCP_OAUTH_JWT_SECRET = 'test-secret-at-least-32-bytes-long-xxxxxxxxxxxxxx';
});

describe('jwt', () => {
  it('signs and verifies a round-trip', async () => {
    const jwt = await signAccessToken({
      userId: '11111111-1111-1111-1111-111111111111',
      companyId: '22222222-2222-2222-2222-222222222222',
      clientId: '33333333-3333-3333-3333-333333333333',
      scopes: ['read'],
    });
    const claims = await verifyAccessToken(jwt);
    expect(claims.sub).toBe('11111111-1111-1111-1111-111111111111');
    expect(claims.cid).toBe('22222222-2222-2222-2222-222222222222');
    expect(claims.cli).toBe('33333333-3333-3333-3333-333333333333');
    expect(claims.scopes).toEqual(['read']);
    expect(claims.iss).toBe('https://locus.app');
    expect(claims.aud).toBe('https://locus.app/api/mcp');
  });

  it('rejects token signed with wrong secret', async () => {
    const jwt = await signAccessToken({
      userId: 'u', companyId: 'c', clientId: 'cl', scopes: [],
    });
    process.env.MCP_OAUTH_JWT_SECRET = 'different-secret-at-least-32-bytes-xxxxxxxxxxxxxx';
    await expect(verifyAccessToken(jwt)).rejects.toThrow();
    process.env.MCP_OAUTH_JWT_SECRET = 'test-secret-at-least-32-bytes-long-xxxxxxxxxxxxxx';
  });

  it('rejects expired token', async () => {
    const jwt = await signAccessToken(
      { userId: 'u', companyId: 'c', clientId: 'cl', scopes: [] },
      { expiresInSeconds: -1 },
    );
    await expect(verifyAccessToken(jwt)).rejects.toThrow();
  });
});

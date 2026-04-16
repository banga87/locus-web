// HS256 access tokens. The issuer and audience are fixed to locus.app;
// if you deploy to a different domain, make them env-driven.

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ISSUER = 'https://locus.app';
const AUDIENCE = 'https://locus.app/api/mcp';
const DEFAULT_EXPIRES_IN = 3600; // 1 hour

export type AccessTokenClaims = JWTPayload & {
  sub: string;
  cid: string;
  cli: string;
  scopes: string[];
};

function secretKey(): Uint8Array {
  const raw = process.env.MCP_OAUTH_JWT_SECRET;
  if (!raw) throw new Error('MCP_OAUTH_JWT_SECRET is not set');
  return new TextEncoder().encode(raw);
}

export async function signAccessToken(
  params: { userId: string; companyId: string; clientId: string; scopes: string[] },
  opts: { expiresInSeconds?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.expiresInSeconds ?? DEFAULT_EXPIRES_IN);
  return new SignJWT({
    cid: params.companyId,
    cli: params.clientId,
    scopes: params.scopes,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(params.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secretKey());
}

export async function verifyAccessToken(jwt: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(jwt, secretKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof payload.sub !== 'string') throw new Error('invalid sub');
  return payload as AccessTokenClaims;
}

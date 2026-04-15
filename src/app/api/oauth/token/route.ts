// POST /api/oauth/token — OAuth 2.1 token endpoint.
//
// Accepts two grant types on a single route, dispatched by the
// `grant_type` form field:
//   - authorization_code: exchanges a PKCE-bound code for an access +
//     refresh token pair.
//   - refresh_token: rotates a refresh token; the presented token is
//     revoked and a new one is issued. Replay of a revoked token
//     chain-revokes the whole family inside `rotateRefreshToken`.
//
// Public clients only (PKCE) — no client authentication, no
// Authorization header. Per RFC 6749, the body is
// application/x-www-form-urlencoded, not JSON.

import { NextResponse } from 'next/server';
import { consumeCode } from '@/lib/oauth/codes';
import { rotateRefreshToken, issueRefreshToken } from '@/lib/oauth/refresh';
import { signAccessToken } from '@/lib/oauth/jwt';

export const runtime = 'nodejs';

const DEFAULT_SCOPES = ['read'];
const ACCESS_TOKEN_TTL_SECONDS = 3600;

function jsonError(error: string, status = 400): Response {
  return NextResponse.json({ error }, { status });
}

function successResponse(body: Record<string, unknown>): Response {
  // OAuth 2.1 §4.1.4: token responses MUST NOT be cached.
  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError('invalid_request');
  }

  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') return handleCode(form);
  if (grantType === 'refresh_token') return handleRefresh(form);
  return jsonError('unsupported_grant_type');
}

async function handleCode(form: FormData): Promise<Response> {
  const code = form.get('code');
  const redirectUri = form.get('redirect_uri');
  const codeVerifier = form.get('code_verifier');
  // client_id is required by RFC 6749 §4.1.3 for public clients but
  // we don't actually need it for lookup — the code hash uniquely
  // identifies the row, and the bound clientId comes back from
  // consumeCode. We still require it in the body for spec compliance.
  const clientId = form.get('client_id');
  if (
    typeof code !== 'string' ||
    typeof redirectUri !== 'string' ||
    typeof codeVerifier !== 'string' ||
    typeof clientId !== 'string'
  ) {
    return jsonError('invalid_request');
  }

  const result = await consumeCode({ code, redirectUri, codeVerifier });
  // v1 double-redemption semantics: consumeCode atomically deletes on
  // any hash match, so a second redemption returns `unknown`. RFC 6749
  // §4.1.2 / OAuth 2.1 §6.1 recommend revoking tokens already issued
  // from the first redemption. We defer: access tokens are stateless
  // 1-hour JWTs (no blocklist yet), and an honest client's retry simply
  // fails here → user re-consents. Revisit when we add a JWT blocklist.
  if (!result.ok) return jsonError('invalid_grant');

  const accessToken = await signAccessToken({
    userId: result.userId,
    companyId: result.companyId,
    clientId: result.clientId,
    scopes: DEFAULT_SCOPES,
  });
  const { refreshToken } = await issueRefreshToken({
    clientId: result.clientId,
    userId: result.userId,
    companyId: result.companyId,
  });
  return successResponse({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
  });
}

async function handleRefresh(form: FormData): Promise<Response> {
  const refreshToken = form.get('refresh_token');
  if (typeof refreshToken !== 'string') return jsonError('invalid_request');

  const result = await rotateRefreshToken({ refreshToken });
  // Any failure mode — unknown / expired / revoked_chain_killed — maps
  // to invalid_grant. The chain-revoke side effect for replays is
  // already applied inside rotateRefreshToken.
  if (!result.ok) return jsonError('invalid_grant');

  const accessToken = await signAccessToken({
    userId: result.userId,
    companyId: result.companyId,
    clientId: result.clientId,
    scopes: DEFAULT_SCOPES,
  });
  return successResponse({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: result.newRefreshToken,
  });
}

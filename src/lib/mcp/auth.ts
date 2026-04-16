// MCP authentication — validates Bearer tokens on every request.
//
// Every MCP request carries its own Authorization: Bearer <token> header.
// There is no session, no cookie, no connection-level auth. This mirrors
// the per-call validation requirement from 11-auth-and-access.md §4.3:
// revocations must take effect on the very next tool call.
//
// Two token shapes are accepted:
//   - PAT: opaque `lat_live_...` / `lat_test_...` tokens issued by the
//     admin UI and validated against the `agent_access_tokens` table.
//   - OAuth: HS256 JWT access tokens issued by the /oauth flow
//     (see `src/lib/oauth/jwt.ts`). Their `sub` claim is a user id and
//     they carry company + client + scopes in custom claims.
//
// Pre-MVP scope: `validateToken()` already filters out revoked / non-active
// rows, so we surface a single `invalid_token` code for any miss. The
// separate `token_revoked` / `token_expired` paths called out in the
// design doc land in Phase 1 alongside the expiration sweep job.

import { validateToken } from '@/lib/auth/tokens';
import { logAuthEvent } from '@/lib/audit/helpers';
import { verifyAccessToken } from '@/lib/oauth/jwt';

export type AuthResult =
  | {
      ok: true;
      tokenId: string;
      companyId: string;
      userId: string | null;
      scopes: string[];
      tokenType: 'pat' | 'oauth';
    }
  | {
      ok: false;
      code: 'missing_token' | 'invalid_token';
      message: string;
    };

/**
 * Authenticate an incoming MCP Request by extracting and validating the
 * Bearer token. Fires `auth.failed` / `token.used` audit events on every
 * outcome so the audit trail is complete.
 */
export async function authenticateAgentToken(
  request: Request,
): Promise<AuthResult> {
  const header =
    request.headers.get('authorization') ??
    request.headers.get('Authorization');

  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    logAuthEvent({
      companyId: 'unknown',
      actorType: 'agent_token',
      actorId: 'unknown',
      eventType: 'auth.failed',
      details: {
        reason: 'missing_token',
        method: 'agent_token',
      },
      tokenType: null,
    });
    return {
      ok: false,
      code: 'missing_token',
      message:
        'Missing or malformed Authorization header. Expected: Bearer <token>',
    };
  }

  const token = header.slice(7).trim();

  if (token.startsWith('lat_live_') || token.startsWith('lat_test_')) {
    return authenticatePat(token);
  }

  return authenticateOAuth(token);
}

async function authenticatePat(token: string): Promise<AuthResult> {
  const record = await validateToken(token);

  if (!record) {
    logAuthEvent({
      companyId: 'unknown',
      actorType: 'agent_token',
      actorId: 'unknown',
      eventType: 'auth.failed',
      details: {
        reason: 'invalid_credentials',
        method: 'agent_token',
        tokenPrefix: token.slice(0, 12),
      },
      tokenType: 'pat',
    });
    return {
      ok: false,
      code: 'invalid_token',
      message: 'Agent Access Token not recognized or revoked.',
    };
  }

  logAuthEvent({
    companyId: record.companyId,
    actorType: 'agent_token',
    actorId: record.id,
    eventType: 'token.used',
    details: {
      tool: 'auth',
      tokenPrefix: record.tokenPrefix,
    },
    tokenId: record.id,
    tokenType: 'pat',
  });

  return {
    ok: true,
    tokenId: record.id,
    companyId: record.companyId,
    userId: null,
    scopes: record.scopes,
    tokenType: 'pat',
  };
}

async function authenticateOAuth(token: string): Promise<AuthResult> {
  try {
    const claims = await verifyAccessToken(token);

    logAuthEvent({
      companyId: claims.cid,
      actorType: 'agent_token',
      actorId: claims.cli,
      eventType: 'token.used',
      details: {
        tool: 'auth',
        method: 'oauth_jwt',
      },
      tokenId: claims.cli,
      tokenType: 'oauth',
    });

    return {
      ok: true,
      tokenId: claims.cli,
      companyId: claims.cid,
      userId: claims.sub,
      scopes: claims.scopes ?? [],
      tokenType: 'oauth',
    };
  } catch {
    logAuthEvent({
      companyId: 'unknown',
      actorType: 'agent_token',
      actorId: 'unknown',
      eventType: 'auth.failed',
      details: {
        reason: 'invalid_credentials',
        method: 'oauth_jwt',
      },
      tokenType: 'oauth',
    });
    return {
      ok: false,
      code: 'invalid_token',
      message: 'Access token not recognized or expired.',
    };
  }
}

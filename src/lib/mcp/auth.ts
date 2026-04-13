// MCP authentication — validates Bearer tokens on every request.
//
// Every MCP request carries its own Authorization: Bearer <token> header.
// There is no session, no cookie, no connection-level auth. This mirrors
// the per-call validation requirement from 11-auth-and-access.md §4.3:
// revocations must take effect on the very next tool call.
//
// Pre-MVP scope: `validateToken()` already filters out revoked / non-active
// rows, so we surface a single `invalid_token` code for any miss. The
// separate `token_revoked` / `token_expired` paths called out in the
// design doc land in Phase 1 alongside the expiration sweep job.

import { validateToken } from '@/lib/auth/tokens';
import { logAuthEvent } from '@/lib/audit/helpers';

export type AuthResult =
  | {
      ok: true;
      tokenId: string;
      companyId: string;
      scopes: string[];
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
    });
    return {
      ok: false,
      code: 'missing_token',
      message:
        'Missing or malformed Authorization header. Expected: Bearer lat_...',
    };
  }

  const token = header.slice(7).trim();
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
  });

  return {
    ok: true,
    tokenId: record.id,
    companyId: record.companyId,
    scopes: record.scopes,
  };
}

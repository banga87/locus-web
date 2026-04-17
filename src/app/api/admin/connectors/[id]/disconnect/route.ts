// POST /api/admin/connectors/[id]/disconnect
//
// Owner-only. Removes a connection from the company's MCP OUT list.
// For OAuth connections that expose a revocation endpoint, we best-
// effort revoke the stored refresh token at the provider before
// deleting the row. Revocation is advisory — if it fails (provider
// down, token already invalid, network hiccup), we still delete the
// row. The alternative (leaving half-disconnected rows on revocation
// failure) is worse UX.
//
// For non-OAuth connections we just delete.
//
// Audit: emits `mcp.connection.deleted` with `via: 'disconnect'`.

import { logEvent } from '@/lib/audit/logger';
import { requireAuth, requireRole } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import {
  decryptCredential,
  deleteConnection,
  getConnection,
} from '@/lib/mcp-out/connections';
import { decodeCredentials } from '@/lib/connectors/credentials';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireAuth();
    requireRole(ctx, 'owner');
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    throw err;
  }

  if (!ctx.companyId) {
    return Response.json(
      { error: 'no_company', message: 'Complete setup first.' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const conn = await getConnection(id, ctx.companyId);
  if (!conn) {
    return Response.json(
      { error: 'not_found', message: 'Connection not found.' },
      { status: 404 },
    );
  }

  // Best-effort refresh-token revocation at the provider. Any failure
  // is swallowed — the row is always deleted.
  if (conn.authType === 'oauth' && conn.credentialsEncrypted) {
    try {
      const creds = decodeCredentials(
        await decryptCredential(conn.credentialsEncrypted),
      );
      if (
        creds.kind === 'oauth' &&
        creds.authServerMetadata.revocationEndpoint &&
        creds.refreshToken
      ) {
        await fetch(creds.authServerMetadata.revocationEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: creds.refreshToken,
            token_type_hint: 'refresh_token',
            client_id: creds.dcrClientId,
          }).toString(),
        }).catch(() => {});
      }
    } catch {
      // Ignore; we'll delete the row regardless.
    }
  }

  await deleteConnection(id, ctx.companyId);

  logEvent({
    companyId: ctx.companyId,
    category: 'administration',
    eventType: 'mcp.connection.deleted',
    actorType: 'human',
    actorId: ctx.userId,
    actorName: ctx.fullName ?? undefined,
    targetType: 'connection',
    targetId: conn.id,
    details: {
      via: 'disconnect',
      authType: conn.authType,
      name: conn.name,
      serverUrl: conn.serverUrl,
    },
  });

  return Response.json({ ok: true });
}

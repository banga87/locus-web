// POST /api/admin/connectors/[id]/oauth/start
//
// Re-authorise an existing OAuth connection. Used when the refresh token
// has been revoked at the provider side or the user just wants to force
// a fresh handshake. We reuse the stored DCR client id/secret from the
// existing credentials blob so reconnects don't burn fresh DCR slots on
// the provider every time.
//
// Flow:
//   1. Owner-gated. Load the connection; 404 if not found.
//   2. Decode the existing credentials. If not OAuth, 400.
//   3. Flip `status` to `pending` (without touching the credentials blob
//      — we still need the DCR client during the callback exchange).
//   4. Generate PKCE + signed state, stash the verifier, build the
//      authorize URL via the shared handshake helper.
//   5. Audit (`mcp.connection.updated`, `via: reconnect`), return
//      `{ authorizeUrl }`.

import { logEvent } from '@/lib/audit/logger';
import { requireAuth, requireRole } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import {
  decryptCredential,
  getConnection,
  updateConnection,
} from '@/lib/mcp-out/connections';
import { decodeCredentials } from '@/lib/connectors/credentials';

import { buildOauthHandshake } from '../../../_oauth-handshake';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
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

  if (!conn.credentialsEncrypted) {
    return Response.json(
      {
        error: 'not_oauth',
        message: 'Not an OAuth connection',
      },
      { status: 400 },
    );
  }

  const creds = decodeCredentials(
    await decryptCredential(conn.credentialsEncrypted),
  );
  if (creds.kind !== 'oauth') {
    return Response.json(
      { error: 'not_oauth', message: 'Not an OAuth connection' },
      { status: 400 },
    );
  }

  // Flip status to `pending` WITHOUT clearing the credentials blob — the
  // callback still needs the DCR client id/secret + metadata to complete
  // the exchange. Reusing the DCR client avoids burning a fresh slot on
  // the provider every reconnect.
  await updateConnection(id, ctx.companyId, { status: 'pending' });

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/admin/connectors/oauth/callback`;

  const { authorizeUrl } = buildOauthHandshake({
    connectionId: conn.id,
    metadata: creds.authServerMetadata,
    dcrClientId: creds.dcrClientId,
    redirectUri,
  });

  logEvent({
    companyId: ctx.companyId,
    category: 'administration',
    eventType: 'mcp.connection.updated',
    actorType: 'human',
    actorId: ctx.userId,
    actorName: ctx.fullName ?? undefined,
    targetType: 'connection',
    targetId: conn.id,
    details: {
      name: conn.name,
      serverUrl: conn.serverUrl,
      authType: conn.authType,
      via: 'reconnect',
    },
  });

  return Response.json({ authorizeUrl });
}

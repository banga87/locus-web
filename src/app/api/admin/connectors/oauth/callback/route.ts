// GET /api/admin/connectors/oauth/callback
//
// Completes the OAuth 2.1 + DCR flow that a catalog install kicked off
// via POST /api/admin/connectors. The authorization server redirects the
// browser here with `?code=...&state=...`. We:
//
//   1. Verify the signed `state` (HMAC + expiry).
//   2. Take (consume) the PKCE verifier stashed against that `state`.
//   3. Exchange the code for tokens via the token endpoint.
//   4. Re-encrypt the credential with real tokens + flip the row to
//      `status = 'active'`.
//
// The response is an HTML page that posts a `connector-oauth-complete`
// message to `window.opener` and closes itself — the settings tab that
// launched the popup listens for this and refreshes its list. On failure
// we render a 400 page with the same shape so the opener can surface
// the error inline.
//
// Note: auth is NOT `requireAuth()` here — the caller is the OAuth
// provider's redirect, not an authenticated Locus user. Security comes
// from the signed `state` (HMAC over the connectionId) + the PKCE
// verifier check: without both, we won't touch any row.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { mcpConnections } from '@/db/schema';
import { logEvent } from '@/lib/audit/logger';
import {
  decodeCredentials,
  encodeCredentials,
} from '@/lib/connectors/credentials';
import { exchangeCodeForTokens } from '@/lib/connectors/mcp-oauth';
import { verifyState } from '@/lib/connectors/pkce';
import { takePkceVerifier } from '@/lib/connectors/pkce-store';
import {
  decryptCredential,
  encryptCredential,
  markConnectionError,
  updateConnectionCredentials,
} from '@/lib/mcp-out/connections';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  if (providerError) {
    return renderResult({
      ok: false,
      message: `Provider returned: ${providerError}`,
    });
  }
  if (!code || !state) {
    return renderResult({ ok: false, message: 'Missing code or state.' });
  }

  const secret = process.env.CONNECTORS_STATE_SECRET;
  if (!secret) {
    return renderResult({ ok: false, message: 'Server misconfigured.' });
  }

  const verified = verifyState(state, secret);
  if (!verified.ok) {
    return renderResult({
      ok: false,
      message: `State invalid: ${verified.reason}`,
    });
  }

  const verifier = takePkceVerifier(state);
  if (!verifier) {
    return renderResult({
      ok: false,
      message: 'Verifier missing or expired.',
    });
  }

  const connectionId = verified.payload.connectionId;
  const conn = await findConnectionById(connectionId);
  if (!conn) {
    return renderResult({ ok: false, message: 'Connection not found.' });
  }

  if (!conn.credentialsEncrypted) {
    return renderResult({
      ok: false,
      message: 'Connection has no placeholder credentials.',
    });
  }

  const placeholder = decodeCredentials(
    await decryptCredential(conn.credentialsEncrypted),
  );
  if (placeholder.kind !== 'oauth') {
    return renderResult({
      ok: false,
      message: 'Unexpected credentials kind.',
    });
  }

  const exchange = await exchangeCodeForTokens(placeholder.authServerMetadata, {
    clientId: placeholder.dcrClientId,
    clientSecret: placeholder.dcrClientSecret,
    code,
    codeVerifier: verifier,
    redirectUri: `${url.origin}/api/admin/connectors/oauth/callback`,
  });
  if (!exchange.ok) {
    await markConnectionError(
      connectionId,
      `OAuth exchange failed: ${exchange.error}`,
    ).catch(() => {});
    return renderResult({ ok: false, message: exchange.error });
  }

  const final = encodeCredentials({
    kind: 'oauth',
    ...exchange.tokens,
    dcrClientId: placeholder.dcrClientId,
    dcrClientSecret: placeholder.dcrClientSecret,
    authServerMetadata: placeholder.authServerMetadata,
  });
  const encrypted = await encryptCredential(final);
  await updateConnectionCredentials(
    connectionId,
    conn.companyId,
    encrypted,
    'active',
  );

  logEvent({
    companyId: conn.companyId,
    category: 'administration',
    eventType: 'mcp.connection.created',
    // The provider's redirect is the HTTP caller here, not a Locus user
    // — the kickoff already logged the 'human' variant of this event.
    actorType: 'system',
    actorId: 'oauth-callback',
    targetType: 'connection',
    targetId: connectionId,
    details: { via: 'oauth', catalogId: conn.catalogId },
  });

  return renderResult({ ok: true, connectionId });
}

async function findConnectionById(id: string) {
  const [row] = await db
    .select()
    .from(mcpConnections)
    .where(eq(mcpConnections.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    catalogId: row.catalogId,
    credentialsEncrypted: row.credentialsEncrypted ?? null,
  };
}

type Result =
  | { ok: true; connectionId: string }
  | { ok: false; message: string };

function renderResult(r: Result): Response {
  const payload = JSON.stringify(r);
  const html = `<!doctype html><meta charset="utf-8"><title>Connecting…</title>
<body style="font:14px system-ui;padding:24px;color:#222">
${r.ok ? 'Connected. This window will close.' : 'Connection failed. You can close this window.'}
<script>
(function () {
  try {
    if (window.opener) {
      window.opener.postMessage({ kind: 'connector-oauth-complete', result: ${payload} }, window.location.origin);
    }
  } catch (e) {}
  setTimeout(function () { window.close(); }, 500);
})();
</script>
</body>`;
  return new Response(html, {
    status: r.ok ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

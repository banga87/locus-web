// Shared OAuth 2.1 + PKCE handshake preparation.
//
// Used by two routes:
//   - Catalog install kickoff (POST /api/admin/connectors) — first-time
//     authorise, after resolving metadata + performing DCR.
//   - Reconnect                (POST /api/admin/connectors/[id]/oauth/start)
//     — re-authorise using the already-stored DCR client details.
//
// The helper is pure: generate PKCE, sign a state, stash the verifier in
// the PKCE store, build the authorize URL. It does NOT touch the DB or
// call `performDcr`. The underscore prefix keeps Next.js from routing
// this file.

import { buildAuthorizeUrl, type AuthServerMetadata } from '@/lib/connectors/mcp-oauth';
import { generatePkce, signState } from '@/lib/connectors/pkce';
import { savePkceVerifier } from '@/lib/connectors/pkce-store';

export interface HandshakeInput {
  connectionId: string;
  metadata: AuthServerMetadata;
  dcrClientId: string;
  redirectUri: string;
}

/**
 * Generate PKCE + state, stash the verifier, build the authorize URL.
 *
 * Throws if `CONNECTORS_STATE_SECRET` is unset — the state must be signed
 * so the callback can verify it wasn't tampered with.
 */
export function buildOauthHandshake(
  input: HandshakeInput,
): { authorizeUrl: string } {
  const secret = process.env.CONNECTORS_STATE_SECRET;
  if (!secret) throw new Error('CONNECTORS_STATE_SECRET not set');

  const { verifier, challenge } = generatePkce();
  const state = signState(
    {
      connectionId: input.connectionId,
      csrf: Math.random().toString(36).slice(2),
    },
    secret,
    600,
  );
  savePkceVerifier(state, verifier);

  const authorizeUrl = buildAuthorizeUrl(input.metadata, {
    clientId: input.dcrClientId,
    redirectUri: input.redirectUri,
    scope: input.metadata.scopesSupported?.join(' ') ?? null,
    state,
    codeChallenge: challenge,
  });

  return { authorizeUrl };
}

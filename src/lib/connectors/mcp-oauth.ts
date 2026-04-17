// MCP OAuth client primitives. Pure — fetch is injectable so tests can
// stub it and no Next.js / @vercel/functions import ever shows up here.
// Follows the MCP auth spec (2025-03-26) + RFC 7591 (DCR) + RFC 8414
// (authorization server metadata).

import type { AuthServerMetadata as AuthServerMetadataType, CredentialsOAuth } from './credentials';

export type AuthServerMetadata = AuthServerMetadataType;

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

// --- resolveAuthServerMetadata -----------------------------------------

export type ResolveResult =
  | { ok: true; metadata: AuthServerMetadata }
  | { ok: false; error: 'dcr_unsupported'; detail?: string };

/**
 * Probe the MCP endpoint for OAuth 2.1 metadata.
 *
 * Order:
 *  1. If the unauthenticated `GET <mcpUrl>` returns `WWW-Authenticate`
 *     with `resource_metadata=` or `as_uri=`, fetch that URL.
 *  2. Otherwise, fetch `<origin>/.well-known/oauth-authorization-server`.
 *  3. If both fail or the metadata lacks required fields, return
 *     `dcr_unsupported`.
 */
export async function resolveAuthServerMetadata(
  mcpUrl: URL,
  fetchFn: FetchLike = fetch,
): Promise<ResolveResult> {
  let probe: Response;
  try {
    probe = await fetchFn(mcpUrl);
  } catch (err) {
    return {
      ok: false,
      error: 'dcr_unsupported',
      detail: err instanceof Error ? err.message : 'probe failed',
    };
  }

  const metaUrl =
    extractMetadataUrl(probe.headers.get('www-authenticate')) ??
    new URL('/.well-known/oauth-authorization-server', mcpUrl).toString();

  let metaRes: Response;
  try {
    metaRes = await fetchFn(metaUrl);
  } catch {
    return { ok: false, error: 'dcr_unsupported', detail: 'metadata fetch failed' };
  }
  if (!metaRes.ok) {
    return { ok: false, error: 'dcr_unsupported', detail: `metadata HTTP ${metaRes.status}` };
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await metaRes.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'dcr_unsupported', detail: 'metadata not JSON' };
  }

  const authorizationEndpoint = raw.authorization_endpoint;
  const tokenEndpoint = raw.token_endpoint;
  const registrationEndpoint = raw.registration_endpoint ?? null;
  if (
    typeof authorizationEndpoint !== 'string' ||
    typeof tokenEndpoint !== 'string' ||
    (registrationEndpoint !== null && typeof registrationEndpoint !== 'string')
  ) {
    return { ok: false, error: 'dcr_unsupported', detail: 'required fields missing' };
  }
  if (!registrationEndpoint) {
    return { ok: false, error: 'dcr_unsupported', detail: 'registration_endpoint missing' };
  }

  return {
    ok: true,
    metadata: {
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint,
      revocationEndpoint:
        typeof raw.revocation_endpoint === 'string' ? raw.revocation_endpoint : null,
      scopesSupported:
        Array.isArray(raw.scopes_supported) && raw.scopes_supported.every((s) => typeof s === 'string')
          ? (raw.scopes_supported as string[])
          : null,
    },
  };
}

function extractMetadataUrl(header: string | null): string | null {
  if (!header) return null;
  // Look for either `resource_metadata="..."` or `as_uri="..."`.
  const m = /(?:resource_metadata|as_uri)="([^"]+)"/i.exec(header);
  return m?.[1] ?? null;
}

// --- performDcr --------------------------------------------------------

export type DcrResult =
  | { ok: true; clientId: string; clientSecret: string | null }
  | { ok: false; error: string };

export async function performDcr(
  metadata: AuthServerMetadata,
  opts: { redirectUri: string; clientName: string },
  fetchFn: FetchLike = fetch,
): Promise<DcrResult> {
  if (!metadata.registrationEndpoint) {
    return { ok: false, error: 'no registration endpoint' };
  }
  const res = await fetchFn(metadata.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: opts.clientName,
      redirect_uris: [opts.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
      application_type: 'web',
    }),
  });
  if (!res.ok) {
    return { ok: false, error: `DCR HTTP ${res.status}` };
  }
  const body = (await res.json()) as Record<string, unknown>;
  const clientId = body.client_id;
  if (typeof clientId !== 'string') {
    return { ok: false, error: 'DCR response missing client_id' };
  }
  return {
    ok: true,
    clientId,
    clientSecret: typeof body.client_secret === 'string' ? body.client_secret : null,
  };
}

// --- buildAuthorizeUrl -------------------------------------------------

export function buildAuthorizeUrl(
  metadata: AuthServerMetadata,
  opts: {
    clientId: string;
    redirectUri: string;
    scope: string | null;
    state: string;
    codeChallenge: string;
  },
): string {
  const u = new URL(metadata.authorizationEndpoint);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', opts.state);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (opts.scope) u.searchParams.set('scope', opts.scope);
  return u.toString();
}

// --- exchangeCodeForTokens --------------------------------------------

type TokenResponseMapped = Omit<CredentialsOAuth, 'kind' | 'dcrClientId' | 'dcrClientSecret' | 'authServerMetadata'>;

export type ExchangeResult =
  | { ok: true; tokens: TokenResponseMapped }
  | { ok: false; error: string };

export async function exchangeCodeForTokens(
  metadata: AuthServerMetadata,
  opts: {
    clientId: string;
    clientSecret: string | null;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
  fetchFn: FetchLike = fetch,
): Promise<ExchangeResult> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    code_verifier: opts.codeVerifier,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
  });
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (opts.clientSecret) {
    headers.authorization =
      'Basic ' +
      Buffer.from(`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`).toString(
        'base64',
      );
  }
  const res = await fetchFn(metadata.tokenEndpoint, {
    method: 'POST',
    headers,
    body: params.toString(),
  });
  if (!res.ok) {
    return { ok: false, error: `token HTTP ${res.status}` };
  }
  const body = (await res.json()) as Record<string, unknown>;
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  const expiresIn = body.expires_in;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    return { ok: false, error: 'token response missing tokens' };
  }
  const expiresSeconds = typeof expiresIn === 'number' ? expiresIn : 3600;
  return {
    ok: true,
    tokens: {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresSeconds * 1000).toISOString(),
      tokenType: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
      scope: typeof body.scope === 'string' ? body.scope : null,
    },
  };
}

// --- refreshIfNeeded ---------------------------------------------------

export type RefreshResult =
  | { kind: 'unchanged' }
  | { kind: 'refreshed'; credentials: CredentialsOAuth }
  | { kind: 'invalid_grant'; error: string };

const REFRESH_SKEW_MS = 60_000;

export async function refreshIfNeeded(
  creds: CredentialsOAuth,
  now: Date,
  fetchFn: FetchLike = fetch,
): Promise<RefreshResult> {
  const expiresAt = new Date(creds.expiresAt).getTime();
  if (expiresAt - now.getTime() > REFRESH_SKEW_MS) {
    return { kind: 'unchanged' };
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.dcrClientId,
  });
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (creds.dcrClientSecret) {
    headers.authorization =
      'Basic ' +
      Buffer.from(`${encodeURIComponent(creds.dcrClientId)}:${encodeURIComponent(creds.dcrClientSecret)}`).toString(
        'base64',
      );
  }
  const res = await fetchFn(creds.authServerMetadata.tokenEndpoint, {
    method: 'POST',
    headers,
    body: params.toString(),
  });
  if (res.status === 400 || res.status === 401) {
    return { kind: 'invalid_grant', error: `refresh HTTP ${res.status}` };
  }
  if (!res.ok) {
    return { kind: 'invalid_grant', error: `refresh HTTP ${res.status}` };
  }
  const body = (await res.json()) as Record<string, unknown>;
  const accessToken = body.access_token;
  if (typeof accessToken !== 'string') {
    return { kind: 'invalid_grant', error: 'refresh response missing access_token' };
  }
  const expiresSeconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  return {
    kind: 'refreshed',
    credentials: {
      ...creds,
      accessToken,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : creds.refreshToken,
      expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
      tokenType: typeof body.token_type === 'string' ? body.token_type : creds.tokenType,
      scope: typeof body.scope === 'string' ? body.scope : creds.scope,
    },
  };
}

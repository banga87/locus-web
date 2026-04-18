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
 * Two metadata shapes are in circulation:
 *   - RFC 9728 Protected Resource Metadata — the document pointed to by
 *     `resource_metadata=` in `WWW-Authenticate`. Contains
 *     `authorization_servers[]`; we fetch
 *     `<issuer>/.well-known/oauth-authorization-server` to get the real
 *     AS metadata (two-hop).
 *   - RFC 8414 Authorization Server Metadata — direct AS metadata with
 *     `authorization_endpoint` / `token_endpoint` /
 *     `registration_endpoint`. Either labelled `as_uri=` in the header,
 *     or served at `<origin>/.well-known/oauth-authorization-server` as
 *     a fallback.
 *
 * Resolution order:
 *   1. Every `resource_metadata=` / `as_uri=` URL in the header, in the
 *      order it appears (some servers — e.g. Sentry — emit multiple
 *      `resource_metadata=` directives and only one of them is real).
 *   2. Fallback: `<origin>/.well-known/oauth-authorization-server` on
 *      the MCP URL.
 * First candidate that resolves to a complete AS metadata document wins.
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

  const hints = extractMetadataHints(probe.headers.get('www-authenticate'));
  const fallback = new URL('/.well-known/oauth-authorization-server', mcpUrl).toString();
  const candidates = [...hints, fallback];

  let lastDetail = 'no metadata candidate succeeded';
  for (const candidate of candidates) {
    const result = await resolveFromCandidate(candidate, fetchFn);
    if (result.ok) return result;
    lastDetail = result.detail ?? lastDetail;
  }
  return { ok: false, error: 'dcr_unsupported', detail: lastDetail };
}

/**
 * Fetch a candidate URL and resolve to AS metadata. The candidate may be
 * either RFC 9728 resource metadata (triggers a second hop to AS metadata
 * via `authorization_servers[0]`) or RFC 8414 AS metadata directly.
 */
async function resolveFromCandidate(
  url: string,
  fetchFn: FetchLike,
): Promise<ResolveResult> {
  const fetched = await fetchJson(url, fetchFn);
  if (!fetched.ok) return fetched;

  // RFC 9728 Protected Resource Metadata → follow authorization_servers[0].
  if (Array.isArray(fetched.body.authorization_servers)) {
    const issuers = fetched.body.authorization_servers.filter(
      (v): v is string => typeof v === 'string',
    );
    if (issuers.length === 0) {
      return {
        ok: false,
        error: 'dcr_unsupported',
        detail: `empty authorization_servers at ${url}`,
      };
    }
    const asUrl = new URL('/.well-known/oauth-authorization-server', issuers[0]).toString();
    const asFetched = await fetchJson(asUrl, fetchFn);
    if (!asFetched.ok) return asFetched;
    return parseAsMetadata(asFetched.body, asUrl);
  }

  // RFC 8414 AS metadata served directly at this URL.
  return parseAsMetadata(fetched.body, url);
}

type FetchJsonResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: 'dcr_unsupported'; detail: string };

async function fetchJson(url: string, fetchFn: FetchLike): Promise<FetchJsonResult> {
  let res: Response;
  try {
    res = await fetchFn(url);
  } catch {
    return { ok: false, error: 'dcr_unsupported', detail: `fetch failed: ${url}` };
  }
  if (!res.ok) {
    return { ok: false, error: 'dcr_unsupported', detail: `HTTP ${res.status} at ${url}` };
  }
  try {
    return { ok: true, body: (await res.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'dcr_unsupported', detail: `not JSON: ${url}` };
  }
}

function parseAsMetadata(raw: Record<string, unknown>, sourceUrl: string): ResolveResult {
  const authorizationEndpoint = raw.authorization_endpoint;
  const tokenEndpoint = raw.token_endpoint;
  const registrationEndpoint = raw.registration_endpoint ?? null;
  if (
    typeof authorizationEndpoint !== 'string' ||
    typeof tokenEndpoint !== 'string' ||
    (registrationEndpoint !== null && typeof registrationEndpoint !== 'string')
  ) {
    return {
      ok: false,
      error: 'dcr_unsupported',
      detail: `required fields missing at ${sourceUrl}`,
    };
  }
  if (!registrationEndpoint) {
    return {
      ok: false,
      error: 'dcr_unsupported',
      detail: `registration_endpoint missing at ${sourceUrl}`,
    };
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

function extractMetadataHints(header: string | null): string[] {
  if (!header) return [];
  // A single WWW-Authenticate header can legitimately carry multiple
  // `resource_metadata=` directives (observed on sentry.dev). Collect all
  // matches in the order they appear so the caller can try each.
  const hints: string[] = [];
  const re = /(?:resource_metadata|as_uri)="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header)) !== null) {
    hints.push(m[1]);
  }
  return hints;
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

import { describe, it, expect, vi } from 'vitest';
import {
  resolveAuthServerMetadata,
  performDcr,
  type AuthServerMetadata,
} from '../mcp-oauth';

const META: AuthServerMetadata = {
  authorizationEndpoint: 'https://provider/authorize',
  tokenEndpoint: 'https://provider/token',
  registrationEndpoint: 'https://provider/register',
  revocationEndpoint: null,
  scopesSupported: null,
};

function fetchMock(responses: Array<{ urlMatch: RegExp; init: ResponseInit; body: unknown }>) {
  return vi.fn(async (input: string | URL) => {
    const url = input.toString();
    const match = responses.find((r) => r.urlMatch.test(url));
    if (!match) throw new Error(`unexpected fetch: ${url}`);
    const body = typeof match.body === 'string' ? match.body : JSON.stringify(match.body);
    return new Response(body, match.init);
  });
}

describe('resolveAuthServerMetadata', () => {
  it('follows WWW-Authenticate resource_metadata', async () => {
    const fetchFn = fetchMock([
      {
        urlMatch: /mcp\.provider\/mcp$/,
        init: {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://provider/.well-known/oauth-authorization-server"' },
        },
        body: {},
      },
      {
        urlMatch: /\.well-known\/oauth-authorization-server$/,
        init: { status: 200, headers: {} },
        body: {
          authorization_endpoint: META.authorizationEndpoint,
          token_endpoint: META.tokenEndpoint,
          registration_endpoint: META.registrationEndpoint,
        },
      },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.metadata.tokenEndpoint).toBe(META.tokenEndpoint);
  });

  it('falls back to origin /.well-known when WWW-Authenticate is absent', async () => {
    const fetchFn = fetchMock([
      {
        urlMatch: /mcp\.provider\/mcp$/,
        init: { status: 401, headers: {} },
        body: {},
      },
      {
        urlMatch: /^https:\/\/mcp\.provider\/\.well-known\/oauth-authorization-server$/,
        init: { status: 200, headers: {} },
        body: {
          authorization_endpoint: META.authorizationEndpoint,
          token_endpoint: META.tokenEndpoint,
          registration_endpoint: META.registrationEndpoint,
        },
      },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(true);
  });

  it('returns dcr_unsupported when both paths fail', async () => {
    const fetchFn = fetchMock([
      { urlMatch: /mcp\.provider\/mcp$/, init: { status: 401, headers: {} }, body: {} },
      { urlMatch: /\.well-known/, init: { status: 404, headers: {} }, body: {} },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('dcr_unsupported');
  });

  it('returns dcr_unsupported when metadata lacks required fields', async () => {
    const fetchFn = fetchMock([
      { urlMatch: /mcp\.provider\/mcp$/, init: { status: 401, headers: {} }, body: {} },
      {
        urlMatch: /\.well-known/,
        init: { status: 200, headers: {} },
        body: { authorization_endpoint: META.authorizationEndpoint }, // missing token + registration
      },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(false);
  });

  it('handles RFC 9728 resource metadata (two-hop: authorization_servers → AS metadata)', async () => {
    // Real Linear / Notion / Sentry shape: resource_metadata= points to a
    // Protected Resource Metadata document with authorization_servers[], and
    // the AS metadata lives at <issuer>/.well-known/oauth-authorization-server.
    const fetchFn = fetchMock([
      {
        urlMatch: /mcp\.provider\/mcp$/,
        init: {
          status: 401,
          headers: {
            'WWW-Authenticate':
              'Bearer realm="OAuth", resource_metadata="https://mcp.provider/.well-known/oauth-protected-resource"',
          },
        },
        body: {},
      },
      {
        urlMatch: /oauth-protected-resource$/,
        init: { status: 200, headers: {} },
        body: {
          resource: 'https://mcp.provider/mcp',
          authorization_servers: ['https://auth.provider'],
          bearer_methods_supported: ['header'],
        },
      },
      {
        urlMatch: /auth\.provider\/\.well-known\/oauth-authorization-server$/,
        init: { status: 200, headers: {} },
        body: {
          authorization_endpoint: 'https://auth.provider/authorize',
          token_endpoint: 'https://auth.provider/token',
          registration_endpoint: 'https://auth.provider/register',
        },
      },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata.authorizationEndpoint).toBe('https://auth.provider/authorize');
      expect(result.metadata.tokenEndpoint).toBe('https://auth.provider/token');
      expect(result.metadata.registrationEndpoint).toBe('https://auth.provider/register');
    }
  });

  it('tries all resource_metadata hints in order (Sentry: first 404s, second works)', async () => {
    // Observed in prod: Sentry returns two resource_metadata= directives in
    // a single WWW-Authenticate header. The first URL 404s; the second is
    // the real one. We must try them in order and not bail on the first miss.
    const fetchFn = fetchMock([
      {
        urlMatch: /mcp\.provider\/mcp$/,
        init: {
          status: 401,
          headers: {
            'WWW-Authenticate':
              'Bearer realm="OAuth", resource_metadata="https://mcp.provider/.well-known/oauth-protected-resource", resource_metadata="https://mcp.provider/.well-known/oauth-protected-resource/mcp"',
          },
        },
        body: {},
      },
      {
        urlMatch: /oauth-protected-resource$/,
        init: { status: 404, headers: {} },
        body: 'Not Found',
      },
      {
        urlMatch: /oauth-protected-resource\/mcp$/,
        init: { status: 200, headers: {} },
        body: {
          resource: 'https://mcp.provider/mcp',
          authorization_servers: ['https://mcp.provider'],
        },
      },
      {
        urlMatch: /mcp\.provider\/\.well-known\/oauth-authorization-server$/,
        init: { status: 200, headers: {} },
        body: {
          authorization_endpoint: 'https://mcp.provider/authorize',
          token_endpoint: 'https://mcp.provider/token',
          registration_endpoint: 'https://mcp.provider/register',
        },
      },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata.registrationEndpoint).toBe('https://mcp.provider/register');
    }
  });

  it('returns dcr_unsupported when resource metadata has empty authorization_servers', async () => {
    const fetchFn = fetchMock([
      {
        urlMatch: /mcp\.provider\/mcp$/,
        init: {
          status: 401,
          headers: {
            'WWW-Authenticate':
              'Bearer resource_metadata="https://mcp.provider/.well-known/oauth-protected-resource"',
          },
        },
        body: {},
      },
      {
        urlMatch: /oauth-protected-resource$/,
        init: { status: 200, headers: {} },
        body: { resource: 'https://mcp.provider/mcp', authorization_servers: [] },
      },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('dcr_unsupported');
  });
});

describe('performDcr', () => {
  it('registers a client with PKCE + authorization_code', async () => {
    const captured: { body?: unknown } = {};
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      captured.body = JSON.parse((init?.body as string) ?? '{}');
      return new Response(
        JSON.stringify({ client_id: 'cid', client_secret: 'csec' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await performDcr(
      META,
      { redirectUri: 'https://locus.local/cb', clientName: 'Locus' },
      fetchFn,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clientId).toBe('cid');
      expect(result.clientSecret).toBe('csec');
    }
    const body = captured.body as Record<string, unknown>;
    expect(body.redirect_uris).toEqual(['https://locus.local/cb']);
    expect(body.grant_types).toContain('authorization_code');
    expect(body.grant_types).toContain('refresh_token');
  });

  it('returns an error on non-2xx', async () => {
    const fetchFn = vi.fn(
      async () => new Response('{"error":"invalid_redirect"}', { status: 400 }),
    );
    const result = await performDcr(
      META,
      { redirectUri: 'https://locus.local/cb', clientName: 'Locus' },
      fetchFn,
    );
    expect(result.ok).toBe(false);
  });
});

import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshIfNeeded,
} from '../mcp-oauth';
import type { CredentialsOAuth } from '../credentials';

describe('buildAuthorizeUrl', () => {
  it('includes PKCE + required params', () => {
    const url = buildAuthorizeUrl(META, {
      clientId: 'cid',
      redirectUri: 'https://locus.local/cb',
      scope: 'read write',
      state: 'sig.state',
      codeChallenge: 'chal',
    });
    expect(url).toMatch(/https:\/\/provider\/authorize/);
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe('https://locus.local/cb');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('sig.state');
    expect(u.searchParams.get('code_challenge')).toBe('chal');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe('read write');
  });
});

describe('exchangeCodeForTokens', () => {
  it('posts the right body and maps the response', async () => {
    let capturedBody = '';
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? '';
      return new Response(
        JSON.stringify({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'read',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await exchangeCodeForTokens(
      META,
      {
        clientId: 'cid',
        clientSecret: 'csec',
        code: 'the-code',
        codeVerifier: 'the-verifier',
        redirectUri: 'https://locus.local/cb',
      },
      fetchFn,
    );
    expect(result.ok).toBe(true);
    const params = new URLSearchParams(capturedBody);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('the-code');
    expect(params.get('code_verifier')).toBe('the-verifier');
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('at');
      expect(result.tokens.refreshToken).toBe('rt');
      expect(new Date(result.tokens.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
  });
});

describe('refreshIfNeeded', () => {
  function makeCreds(offsetMs: number): CredentialsOAuth {
    return {
      kind: 'oauth',
      accessToken: 'old-at',
      refreshToken: 'rt',
      expiresAt: new Date(Date.now() + offsetMs).toISOString(),
      tokenType: 'Bearer',
      scope: null,
      dcrClientId: 'cid',
      dcrClientSecret: 'csec',
      authServerMetadata: META,
    };
  }

  it('returns unchanged when far from expiry', async () => {
    const fetchFn = vi.fn();
    const result = await refreshIfNeeded(makeCreds(10 * 60_000), new Date(), fetchFn);
    expect(result.kind).toBe('unchanged');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refreshes when within 60s of expiry', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'new-at',
            refresh_token: 'new-rt',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: {} },
        ),
    );
    const result = await refreshIfNeeded(makeCreds(30_000), new Date(), fetchFn);
    expect(result.kind).toBe('refreshed');
    if (result.kind === 'refreshed') {
      expect(result.credentials.accessToken).toBe('new-at');
      expect(result.credentials.refreshToken).toBe('new-rt');
    }
  });

  it('returns invalid_grant on 400', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('{"error":"invalid_grant"}', { status: 400, headers: {} }),
    );
    const result = await refreshIfNeeded(makeCreds(30_000), new Date(), fetchFn);
    expect(result.kind).toBe('invalid_grant');
  });
});

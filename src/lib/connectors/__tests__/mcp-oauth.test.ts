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
    return new Response(JSON.stringify(match.body), match.init);
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

// @vitest-environment node
// /api/mcp route handler tests.
//
// Focus: the resource-level 401 path. When a request arrives with no
// Authorization header we must return HTTP 401 with a WWW-Authenticate
// challenge that points clients at the OAuth resource-metadata doc.
// This is what makes MCP OAuth discovery (RFC 9728) work — without the
// header, clients can't find the authorization server.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/functions', () => ({
  waitUntil: (_p: Promise<unknown>) => undefined,
}));

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

import { POST } from '../route';

describe('POST /api/mcp — 401 discovery headers', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_ORIGIN;
  });

  it('returns 401 with WWW-Authenticate header when no Bearer token is present', async () => {
    const req = new Request('https://locus.app/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get('www-authenticate');
    expect(wwwAuth).toBeTruthy();
    expect(wwwAuth).toContain('Bearer');
    expect(wwwAuth).toContain('resource_metadata=');
    expect(wwwAuth).toContain('oauth-protected-resource');
  });

  it('returns 401 with WWW-Authenticate header for an invalid token', async () => {
    const req = new Request('https://locus.app/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer lat_live_bogusbogusbogusbogusbogusbogusbogusbogusbogusbogus',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('uses NEXT_PUBLIC_APP_ORIGIN in the resource_metadata URL when set', async () => {
    process.env.NEXT_PUBLIC_APP_ORIGIN = 'https://staging.locus.app';

    const req = new Request('https://staging.locus.app/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      'https://staging.locus.app/.well-known/oauth-protected-resource',
    );
  });
});

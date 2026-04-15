// Route-handler tests for OAuth discovery endpoints.
// The handlers are thin — they just derive origin from the request URL
// and delegate to the pure metadata builders — but we still exercise
// them end-to-end to catch wiring regressions.

import { describe, expect, it } from 'vitest';
import { GET as getPR } from '../oauth-protected-resource/route';
import { GET as getAS } from '../oauth-authorization-server/route';

describe('.well-known routes', () => {
  it('oauth-protected-resource returns metadata with request origin', async () => {
    const req = new Request('https://example.com/.well-known/oauth-protected-resource');
    const res = await getPR(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.resource).toBe('https://example.com/api/mcp');
    expect(json.authorization_servers).toEqual(['https://example.com']);
  });

  it('oauth-authorization-server returns metadata with request origin', async () => {
    const req = new Request('https://example.com/.well-known/oauth-authorization-server');
    const res = await getAS(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.issuer).toBe('https://example.com');
    expect(json.authorization_endpoint).toBe('https://example.com/api/oauth/authorize');
    expect(json.token_endpoint).toBe('https://example.com/api/oauth/token');
    expect(json.registration_endpoint).toBe('https://example.com/api/oauth/register');
  });
});

// POST /api/oauth/register — RFC 7591 Dynamic Client Registration.
// These tests hit the live database; rows are cleaned up per-test.

import { afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { oauthClients } from '@/db/schema';
import { POST } from '../route';

const inserted: string[] = [];
afterEach(async () => {
  if (inserted.length) {
    await db.delete(oauthClients).where(inArray(oauthClients.clientId, inserted));
    inserted.length = 0;
  }
});

function jsonReq(body: unknown) {
  return new Request('https://x/api/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/oauth/register', () => {
  it('returns 201 and a client_id for a valid localhost registration', async () => {
    const res = await POST(jsonReq({
      client_name: 'Test Client',
      redirect_uris: ['http://localhost:3000/cb'],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.client_name).toBe('Test Client');
    expect(body.redirect_uris).toEqual(['http://localhost:3000/cb']);
    expect(body.token_endpoint_auth_method).toBe('none');
    inserted.push(body.client_id);
  });

  it('rejects non-localhost redirect URIs with invalid_redirect_uri', async () => {
    const res = await POST(jsonReq({
      client_name: 'Evil',
      redirect_uris: ['https://evil.com/cb'],
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_redirect_uri');
  });

  it('rejects invalid JSON with invalid_request', async () => {
    const res = await POST(jsonReq('not json'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('rejects missing redirect_uris with invalid_request', async () => {
    const res = await POST(jsonReq({ client_name: 'X' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });
});

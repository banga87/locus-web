// POST /api/oauth/register — Dynamic Client Registration (RFC 7591).
//
// Public clients only: no client_secret is issued, no auth is required
// to register. Redirect URIs are validated to the localhost-only rule
// in `@/lib/oauth/redirect-uri` before persisting; anything else is
// rejected with `invalid_redirect_uri`.
//
// RFC 7591 doesn't define a single "invalid_request" code, but we use
// it here (with 400) for any malformed body — matching the OAuth 2.1
// error shape the rest of this codebase uses.

import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { logger as axiomLogger } from '@/lib/axiom/server';
import { registerClient } from '@/lib/oauth/clients';

export const runtime = 'nodejs';

function flush(): void {
  waitUntil(axiomLogger.flush());
}

const Body = z.object({
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(z.string()).min(1),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    axiomLogger.warn('oauth.register.rejected', { reason: 'invalid_json' });
    flush();
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    axiomLogger.warn('oauth.register.rejected', { reason: 'schema_mismatch' });
    flush();
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const client = await registerClient({
      clientName: parsed.data.client_name,
      redirectUris: parsed.data.redirect_uris,
      grantTypes: parsed.data.grant_types,
    });
    axiomLogger.info('oauth.register.issued', { clientId: client.clientId });
    flush();
    return NextResponse.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        token_endpoint_auth_method: 'none',
      },
      { status: 201 },
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'error';
    if (msg.startsWith('invalid_redirect_uri')) {
      axiomLogger.warn('oauth.register.rejected', { reason: 'invalid_redirect_uri' });
      flush();
      return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
    }
    axiomLogger.error('oauth.register.server_error', { message: msg });
    flush();
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

// RFC 8414 authorization-server metadata.
// Mounted at `/.well-known/oauth-authorization-server`. Advertises the
// authorize/token/registration endpoints and supported features
// (S256 PKCE, public clients, authorization_code + refresh_token grants).

import { NextResponse } from 'next/server';
import { authorizationServerMetadata } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';

export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  return NextResponse.json(authorizationServerMetadata(origin));
}

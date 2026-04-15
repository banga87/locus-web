// RFC 9728 protected-resource metadata.
// Mounted at `/.well-known/oauth-protected-resource`. MCP clients fetch
// this after a 401 to discover which authorization server(s) guard the
// resource. Pure derivation from request origin — no DB, no auth.

import { NextResponse } from 'next/server';
import { protectedResourceMetadata } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';

export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  return NextResponse.json(protectedResourceMetadata(origin));
}

// Edge middleware: log requests to Axiom + refresh Supabase session + gate
// unauthenticated users.
//
// Pass-through routes skip both the session refresh and the auth gate:
//   - /api/axiom              — Axiom log proxy (must accept logs before auth)
//   - /api/mcp/*              — bearer-token-authenticated MCP endpoints
//   - /api/auth/*             — our own auth callbacks (session doesn't exist yet)
//   - /api/oauth/register     — RFC 7591 DCR (public)
//   - /api/oauth/token        — token endpoint (authed via client_id + PKCE)
//   - /.well-known/*          — OAuth/OIDC metadata (public)
//   - /auth/*                 — public auth pages (verify, mcp consent)
//   - /login, /signup         — public auth pages
//   - /_next/*, /favicon.ico  — static assets
//
// /api/oauth/* is rate-limited per IP (30 req/min, in-memory per region).
// /api/oauth/authorize + subpaths still require a Supabase session, so
// they fall through to `updateSession` below after the rate-limit check.
//
// All other paths go through `updateSession` from @/lib/supabase/middleware,
// which refreshes the session cookie and redirects unauthenticated users to
// /login (or returns JSON 401 for /api/* routes).
//
// See design doc 14-frontend-architecture.md §1.3.

import { transformMiddlewareRequest } from '@axiomhq/nextjs';
import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/axiom/server';
import { oauthRateLimiter } from '@/lib/oauth/rate-limit';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  logger.info(...transformMiddlewareRequest(request));
  event.waitUntil(logger.flush());

  // Waitlist gate: while the private beta runs on the homepage form,
  // /login and /signup are not reachable by visitors. Bounce them to
  // the homepage where they can join the waitlist. App-side redirects
  // to /login (e.g. `(app)/layout.tsx`) inherit this bounce.
  if (pathname === '/login' || pathname === '/signup') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Rate-limit all /api/oauth/* endpoints by client IP. Applied before
  // the pass-through branch so register/token are also protected.
  if (pathname.startsWith('/api/oauth/')) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';
    if (!oauthRateLimiter.check(ip)) {
      return new NextResponse('Too Many Requests', { status: 429 });
    }
    // Public endpoints: no Supabase session required.
    if (
      pathname === '/api/oauth/register' ||
      pathname === '/api/oauth/token'
    ) {
      return NextResponse.next();
    }
    // /api/oauth/authorize + subpaths need the user's Supabase session,
    // so fall through to `updateSession` below.
  }

  // Pass-through: no session refresh, no auth gate.
  if (
    pathname.startsWith('/api/axiom') ||
    pathname.startsWith('/api/mcp') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/.well-known/') ||
    pathname.startsWith('/auth/') ||
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except static files and common image formats.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

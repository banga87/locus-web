// Edge middleware: log requests to Axiom + refresh Supabase session + gate
// unauthenticated users.
//
// Pass-through routes skip the session refresh and auth gate:
//   - /api/axiom      — Axiom log proxy (must accept logs before auth)
//   - /api/mcp/*      — bearer-token-authenticated MCP endpoints
//   - /api/auth/*     — our own auth callbacks (session doesn't exist yet)
//   - /auth/*         — public auth pages (verify)
//   - /login, /signup — public auth pages
//   - /_next/*, /favicon.ico — static assets
//
// All other paths go through `updateSession` from @/lib/supabase/middleware,
// which refreshes the session cookie and redirects unauthenticated users to
// /login (or returns JSON 401 for /api/* routes).
//
// See design doc 14-frontend-architecture.md §1.3.

import { transformMiddlewareRequest } from '@axiomhq/nextjs';
import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/axiom/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  logger.info(...transformMiddlewareRequest(request));
  event.waitUntil(logger.flush());

  // Pass-through: no session refresh, no auth gate.
  if (
    pathname.startsWith('/api/axiom') ||
    pathname.startsWith('/api/mcp') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/auth/') ||
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

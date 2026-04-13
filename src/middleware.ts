// Edge middleware: refresh Supabase session + gate unauthenticated users.
//
// Pass-through routes skip both the session refresh and the auth gate:
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

import { type NextRequest, NextResponse } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pass-through: no session refresh, no auth gate.
  if (
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

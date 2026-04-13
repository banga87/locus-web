import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase session cookie on every gated request and enforces
// the auth gate. Returns either the pass-through response (with refreshed
// cookies) or a redirect/JSON 401 if the user is unauthenticated.
//
// Originally scaffolded by the shadcn/supabase registry; we've adjusted:
//  - redirect path `/auth/login` -> `/login` to match our plan
//  - API routes get a JSON 401 instead of an HTML redirect
//  - authenticated users on /login or /signup get bounced to `/`

export async function updateSession(request: NextRequest) {
  // Stamp the current pathname so server components / layouts can read it
  // via `headers()`. Next.js doesn't expose `usePathname`-equivalent on the
  // server, and we need it in `(app)/layout.tsx` to decide whether to
  // redirect to /setup without infinite-looping the /setup page itself.
  request.headers.set('x-pathname', request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request,
  });

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isAuthPage = pathname === '/login' || pathname === '/signup';

  if (!user) {
    // API routes should never redirect — they return a JSON 401 so fetch
    // clients can handle the error themselves.
    if (isApi) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'unauthenticated',
            message: 'Sign in required.',
          },
        },
        { status: 401 },
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Authenticated users shouldn't see the login / signup forms — bounce to
  // the dashboard. (The dashboard itself redirects to /setup when no
  // company is attached.)
  if (isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make
  // sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid
  //    changing the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go
  // out of sync and terminate the user's session prematurely.

  return supabaseResponse;
}

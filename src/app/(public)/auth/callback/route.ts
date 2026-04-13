// Supabase auth callback. Reached when a user clicks their email-verification
// link (sign-up) or an OAuth redirect lands here.
//
// Responsibilities:
//   1. Exchange the single-use `code` param for a real session cookie.
//   2. Ensure a `public.users` row exists for the auth.users id. Supabase
//      Auth owns auth.users, but our application tables live in
//      public.users — this is where the two are stitched together.
//   3. Redirect to /setup if the profile has no companyId yet, otherwise
//      to the dashboard.
//
// Design doc ref: 11-auth-and-access.md §1.3, 13-api-design.md §1.2.

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { users } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('Missing code.')}`,
    );
  }

  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        exchangeError.message || 'Email verification failed.',
      )}`,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        'Session was not established.',
      )}`,
    );
  }

  // Ensure the public.users row exists. At this point Supabase Auth has
  // verified the email, so we can safely mark the row `active` even
  // though the RLS policy would also accept `invited`.
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!existing) {
    // Derive a sensible full-name default. We don't collect a name at
    // signup today, so use the email local-part; the setup wizard (or a
    // future profile page) can overwrite it.
    const email = user.email ?? '';
    const fallbackName = email.split('@')[0] || 'New user';

    await db.insert(users).values({
      id: user.id,
      email,
      fullName: fallbackName,
      // Pre-MVP is solo-founder-first: the creator of the account becomes
      // the Owner of the company they're about to set up. Phase 2 reworks
      // this for invite-based joiners.
      role: 'owner',
      status: 'active',
      companyId: null,
    });
  }

  const needsSetup = !existing || !existing.companyId;
  return NextResponse.redirect(needsSetup ? `${origin}/setup` : `${origin}/`);
}

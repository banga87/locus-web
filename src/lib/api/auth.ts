// requireAuth / requireRole — the canonical way for route handlers and
// Server Components to get an authenticated user context. See design doc
// 13-api-design.md §3.2.
//
// `requireAuth()` resolves the Supabase Auth user from the request cookies,
// then joins to the public `users` table to load the company/role profile.
// Throws ApiAuthError on any failure — callers catch and map to the API
// error envelope.
//
// The `no_profile` case is the sign-up gap: the auth.users row exists
// (Supabase Auth owns it) but the public.users row hasn't been created yet.
// The auth callback route creates it on first verification; the setup
// wizard fills in companyId. Routes that hit this path should usually
// redirect to /setup rather than hard-fail.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { users } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';

import { ApiAuthError } from './errors';

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

export type AuthContext = {
  userId: string;
  companyId: string | null;
  role: Role;
  email: string;
  fullName: string | null;
};

export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new ApiAuthError(401, 'unauthenticated', 'Sign in required.');
  }

  const [profile] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (!profile) {
    // Auth user exists but no public.users row yet — post-signup gap.
    // Callers (middleware, setup wizard) should route to /setup.
    throw new ApiAuthError(
      403,
      'no_profile',
      'No user profile. Complete setup.',
    );
  }

  if (profile.status !== 'active' && profile.status !== 'invited') {
    throw new ApiAuthError(403, 'account_disabled', 'Account is deactivated.');
  }

  return {
    userId: user.id,
    companyId: profile.companyId ?? null,
    role: (profile.role ?? 'viewer') as Role,
    email: user.email ?? profile.email,
    fullName: profile.fullName ?? null,
  };
}

const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

export function requireRole(ctx: AuthContext, minimum: Role): void {
  if (ROLE_HIERARCHY[ctx.role] < ROLE_HIERARCHY[minimum]) {
    throw new ApiAuthError(
      403,
      'insufficient_role',
      `Requires ${minimum} role or higher.`,
    );
  }
}

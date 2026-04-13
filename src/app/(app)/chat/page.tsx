// /chat — Server Component entry point.
//
// Creates a real session via the session manager (server-side, no HTTP
// round-trip back to our own API), then redirects to /chat/[sessionId].
// Replaces the Task 1 stub which generated a `pending-xxxxxxxx` fake id.
//
// Auth: requires a Supabase session AND a companyId. The (app) layout
// already guards both — by the time we run we know `requireAuth()`
// will succeed and `companyId` is set.

import { redirect } from 'next/navigation';

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getBrainForCompany } from '@/lib/brain/queries';
import { sessionManager } from '@/lib/sessions/manager';

export default async function ChatIndexPage(): Promise<never> {
  let auth;
  try {
    auth = await requireAuth();
  } catch (err) {
    if (err instanceof ApiAuthError && err.statusCode === 401) {
      redirect('/login');
    }
    throw err;
  }

  if (!auth.companyId) {
    redirect('/setup');
  }

  const brain = await getBrainForCompany(auth.companyId);

  const session = await sessionManager.create({
    companyId: auth.companyId,
    brainId: brain.id,
    userId: auth.userId,
  });

  redirect(`/chat/${session.id}`);
}

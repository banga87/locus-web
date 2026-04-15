// /auth/mcp — consent screen for the incoming OAuth authorization flow.
//
// Flow:
//   1. External MCP client hits GET /api/oauth/authorize → creates an
//      oauth_sessions row with a session_ref, redirects here with
//      ?session=<ref>.
//   2. User (already logged into Locus, or redirected through /login)
//      sees the client name and Connect/Cancel buttons.
//   3. Submitting either button POSTs to /api/oauth/authorize/approve
//      or /deny, which consumes the session and redirects back to the
//      client's redirect_uri.
//
// Server component. requireAuth() throws ApiAuthError(401) when not
// signed in — we catch that and redirect to /login with a `next` param
// so the user lands back here after signing in.

import { redirect } from 'next/navigation';

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getClientById } from '@/lib/oauth/clients';
import { getSession } from '@/lib/oauth/sessions';

import { ConsentForm } from './_components/consent-form';

export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;

  try {
    await requireAuth();
  } catch (e) {
    if (e instanceof ApiAuthError && e.statusCode === 401) {
      const next = `/auth/mcp?session=${encodeURIComponent(session ?? '')}`;
      redirect(`/login?next=${encodeURIComponent(next)}`);
    }
    throw e;
  }

  if (!session) return <ExpiredView />;

  const sess = await getSession(session);
  if (!sess) return <ExpiredView />;

  const client = await getClientById(sess.clientId);
  if (!client) return <ExpiredView />;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <h1 className="font-display text-xl font-semibold text-foreground">
        {client.clientName} wants to connect to your Locus brain.
      </h1>
      <p className="mt-4 text-sm text-muted-foreground">
        It will be able to read your documents, folders, skills, and
        traverse your brain graph.
      </p>
      <ConsentForm sessionRef={session} />
    </main>
  );
}

function ExpiredView() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <h1 className="font-display text-xl font-semibold text-foreground">
        This sign-in request has expired
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Please restart the connection from your app.
      </p>
    </main>
  );
}

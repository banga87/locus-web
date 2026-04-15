// POST /api/oauth/authorize/approve — the user clicked "Allow" on the
// consent page. We:
//   1. Re-authenticate (Supabase cookie is our only auth story here).
//   2. Look up the pre-consent session by session_ref (from the form POST).
//   3. Mint a one-time authorization code bound to (client, user, company,
//      redirect_uri, code_challenge).
//   4. Delete the session so session_ref can't be replayed.
//   5. Render the branded success HTML whose hidden iframe delivers
//      `?code=...&state=...` back to the localhost redirect_uri.
//
// CSRF: no explicit token in v1. The Supabase auth cookie is `SameSite=Lax`
// by browser default, which blocks cross-site POST form submits from
// carrying it — so requireAuth() will naturally reject any cross-site
// forgery attempt with 401. If we ever relax SameSite on that cookie we
// MUST add a CSRF token here (double-submit or origin check).

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getSession, deleteSession } from '@/lib/oauth/sessions';
import { generateCode } from '@/lib/oauth/codes';
import { buildSuccessPageHtml } from '@/lib/oauth/success-page';

export const runtime = 'nodejs';

function errorHtml(status: number, title: string, detail: string): Response {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${safeTitle}</title>` +
      `<main style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>${safeTitle}</h1><p>${safeDetail}</p></main>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export async function POST(request: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return new Response(JSON.stringify({ error: e.code }), {
        status: e.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw e;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorHtml(400, 'Invalid request', 'Could not parse form body.');
  }
  const sessionRef = form.get('session_ref');
  if (typeof sessionRef !== 'string' || sessionRef.length === 0) {
    return errorHtml(400, 'Invalid request', 'Missing session_ref.');
  }

  const session = await getSession(sessionRef);
  if (!session) {
    return errorHtml(
      400,
      'Consent session expired',
      'This consent session is no longer valid. Please return to the app and try again.',
    );
  }

  if (!ctx.companyId) {
    return errorHtml(
      500,
      'Setup incomplete',
      'Your account is not yet associated with a company. Finish setup before connecting MCP clients.',
    );
  }

  const { code } = await generateCode({
    clientId: session.clientId,
    userId: ctx.userId,
    companyId: ctx.companyId,
    redirectUri: session.redirectUri,
    codeChallenge: session.codeChallenge,
  });
  await deleteSession(sessionRef);

  const separator = session.redirectUri.includes('?') ? '&' : '?';
  let redirectTarget =
    session.redirectUri + separator + 'code=' + encodeURIComponent(code);
  if (session.state) {
    redirectTarget += '&state=' + encodeURIComponent(session.state);
  }

  return new Response(buildSuccessPageHtml({ redirectTarget }), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

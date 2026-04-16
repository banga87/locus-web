// POST /api/oauth/authorize/deny — the user clicked "Deny" on the consent
// page. We delete the pre-consent session and 302 back to the client's
// redirect_uri with `error=access_denied` (+ state echo) per OAuth 2.1.
//
// CSRF: see the same note in approve/route.ts — we rely on the
// Supabase auth cookie being SameSite=Lax to block cross-site forgery.

import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { logger as axiomLogger } from '@/lib/axiom/server';
import { getSession, deleteSession } from '@/lib/oauth/sessions';

export const runtime = 'nodejs';

function flush(): void {
  waitUntil(axiomLogger.flush());
}

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
    // Without the session we don't know where to bounce the user, so
    // render an HTML page instead of an open redirect.
    return errorHtml(
      400,
      'Consent session expired',
      'This consent session is no longer valid. Please return to the app and try again.',
    );
  }

  await deleteSession(sessionRef);
  axiomLogger.info('oauth.consent.denied', {
    clientId: session.clientId,
    userId: ctx.userId,
  });
  flush();

  const separator = session.redirectUri.includes('?') ? '&' : '?';
  let denyUrl = session.redirectUri + separator + 'error=access_denied';
  if (session.state) {
    denyUrl += '&state=' + encodeURIComponent(session.state);
  }

  return NextResponse.redirect(denyUrl, 302);
}

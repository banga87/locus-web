// GET /api/oauth/authorize — kicks off the OAuth 2.1 + PKCE consent flow.
//
// Flow:
//   1. requireAuth() — unauthenticated users bounce to /login?next=<this URL>.
//      Authenticated but malformed/bad requests get a 400 HTML error page
//      instead of a redirect: a client sending broken params hasn't earned
//      a bounce with a code.
//   2. Validate the OAuth params: response_type=code, code_challenge_method=S256,
//      client_id + redirect_uri + code_challenge all present.
//   3. Load the client, confirm redirect_uri is in its registered list AND
//      passes the localhost-only rule (double-check in case the client row
//      was ever populated outside the DCR endpoint).
//   4. Mint a pre-consent session (5-min TTL) and 302 the browser to the
//      consent page at /auth/mcp?session=<ref>.
//
// Errors that would leak sensitive data if bounced back (unknown client,
// wrong redirect URI, bad params) render a plain 400 HTML page instead.

import { NextResponse } from 'next/server';
import { ApiAuthError } from '@/lib/api/errors';
import { requireAuth } from '@/lib/api/auth';
import { getClientById, touchClient } from '@/lib/oauth/clients';
import { createSession } from '@/lib/oauth/sessions';
import { isLocalhostRedirectUri } from '@/lib/oauth/redirect-uri';

export const runtime = 'nodejs';

function errorHtml(title: string, detail: string): Response {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${safeTitle}</title>` +
      `<main style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
      `<h1>${safeTitle}</h1><p>${safeDetail}</p></main>`,
    { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAuth();
  } catch (e) {
    if (e instanceof ApiAuthError && e.statusCode === 401) {
      const loginUrl = new URL(
        `/login?next=${encodeURIComponent(request.url)}`,
        request.url,
      );
      return NextResponse.redirect(loginUrl);
    }
    throw e;
  }

  const url = new URL(request.url);
  const responseType = url.searchParams.get('response_type');
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const state = url.searchParams.get('state');

  if (responseType !== 'code') {
    return errorHtml(
      'Invalid request',
      'response_type must be "code".',
    );
  }
  if (codeChallengeMethod !== 'S256') {
    return errorHtml(
      'Invalid request',
      'code_challenge_method must be "S256".',
    );
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return errorHtml(
      'Invalid request',
      'Missing required parameter (client_id, redirect_uri, or code_challenge).',
    );
  }

  const client = await getClientById(clientId);
  if (!client) {
    return errorHtml('Unknown client', 'This client_id is not registered.');
  }

  if (
    !client.redirectUris.includes(redirectUri) ||
    !isLocalhostRedirectUri(redirectUri)
  ) {
    return errorHtml(
      'Invalid redirect URI',
      'This redirect_uri is not allowed for this client.',
    );
  }

  await touchClient(clientId);
  const session = await createSession({
    clientId,
    redirectUri,
    codeChallenge,
    state,
  });

  const consentUrl = new URL(
    `/auth/mcp?session=${encodeURIComponent(session.sessionRef)}`,
    request.url,
  );
  return NextResponse.redirect(consentUrl, 302);
}

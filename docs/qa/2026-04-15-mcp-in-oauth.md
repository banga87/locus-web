# MCP-IN OAuth manual QA checklist — 2026-04-15

Run this against a preview deploy (not local) before promoting to production.
Fill in observed behavior next to each item.

## Pre-flight

- [ ] `.env` vars set in Vercel: `MCP_OAUTH_JWT_SECRET`, `NEXT_PUBLIC_APP_ORIGIN`.
- [ ] Migration `0015_mcp_in_oauth.sql` applied to the preview DB.
- [ ] `/.well-known/oauth-protected-resource` returns 200 JSON with the right origin.
- [ ] `/.well-known/oauth-authorization-server` returns 200 JSON with the right origin.
- [ ] `POST /api/mcp` without Authorization returns 401 + `WWW-Authenticate: Bearer realm="locus", resource_metadata="..."`.

## Happy path — Chrome (clean profile)

- [ ] In Claude Code, run `claude mcp add --transport http locus https://<preview>.vercel.app/api/mcp`.
- [ ] First tool call opens a browser tab. Logged out of Tatara → redirected to `/login`.
- [ ] Log in. Consent page renders with client name "Claude Code" and the description.
- [ ] Click Connect. See the branded success screen with "Connected to Tatara".
- [ ] Claude Code reports the tool call worked.
- [ ] Hit a second tool call. Uses the cached token. Succeeds without reopening the browser.

## Happy path — already logged in

- [ ] Same flow but start already logged into Tatara. Consent page renders immediately without a login detour.

## Other browsers

- [ ] Safari: full flow works end-to-end.
- [ ] Firefox: full flow works end-to-end.

## Edge cases

- [ ] Click Cancel instead of Connect → browser lands at `localhost:...?error=access_denied`. Claude Code reports the user denied.
- [ ] Let the consent session expire (>5 min). Reload the consent page. Renders "This sign-in request has expired" without side effects.
- [ ] Disconnect from `/settings/agent-access`. Make a new tool call from Claude Code within the same hour. The call succeeds once (access token still valid), then on next refresh the refresh call fails, and Claude Code re-initiates auth.
- [ ] Mixed-content iframe: the success page's hidden iframe targets `http://localhost:...` from `https://locus.app`. Confirm Chrome delivers the code; if it's blocked, the fallback link appears after 5s and works when clicked.

## Refresh token replay

- [ ] Capture a refresh token from the token response (dev tools). Rotate it once. Try the old one — expect 400 `invalid_grant`. Attempt to use the NEW one after — also fails (chain killed).

## Load / abuse

- [ ] Point a simple load generator at `POST /api/oauth/register` with ~100 rps from one IP. Rate limiter (30/min/IP) kicks in with 429 after the first 30. Other IPs unaffected.

## Notes

- [ ] Paste any observed anomalies here.

# Connectors: sidebar-level browse/install UX backed by MCP OAuth DCR

**Date:** 2026-04-17
**Status:** Draft
**Scope:** New `/connectors` route, `/api/admin/connectors/**` API surface, static catalog module, MCP OAuth DCR client, `mcp_connections` schema extension, sidebar nav update. Touches but does not modify `/settings/agent-access`.

## Motivation

Outbound tool connections are central to the Platform Agent's value — they're what makes the agent useful beyond Locus itself. Today:

1. **The sidebar link is broken.** `SidebarExpanded` links to `/mcp`, which is a 404. The real page lives at `/settings/mcp-connections`.
2. **The add-connector flow is raw.** Paste a server URL, paste a bearer token. Works, but has no product framing and no affordance for "here are things you can connect."
3. **The label is technical.** "MCP Connections" surfaces protocol jargon in navigation. Claude.ai, ChatGPT, and Cursor all use "Connectors" now; that's the mental model users arrive with.
4. **OAuth is unsupported for outbound.** Every modern hosted MCP server (Linear, Notion, Sentry, GitHub, Stripe, etc.) exposes OAuth 2.1 with Dynamic Client Registration per the [MCP auth spec](https://modelcontextprotocol.io/specification/2025-03-26). A bearer-only flow forces users through API-key UIs on each provider when they shouldn't have to.

This spec promotes outbound connections to a sidebar-level surface modelled on claude.ai/settings/connectors, with a curated catalog + one-click OAuth via MCP's standard DCR spec, and a "Custom connector" escape hatch for power users pointing at arbitrary MCP endpoints.

Inbound concerns — the per-user OAuth clients listed under "Connected apps", and the company-level "Access tokens" — stay on `/settings/agent-access` untouched. They serve a different job (audit/revoke of *things that act in Locus*) and the two-page split was intentional; revisiting that page is a separate pass after this lands.

## Decisions taken during brainstorming

These were settled in dialogue and are load-bearing for the rest of the spec. Recording them here so the plan author doesn't re-litigate.

- **Scope split**: `/connectors` is outbound-only (A). Inbound (B) and PATs (C) stay on `/settings/agent-access`.
- **Catalog model**: static TS file in the repo, not a DB table. Adding a provider = code change.
- **Connection scope**: company-level only for MVP (matches today). Per-user connections deferred.
- **Custom connector tile**: keep as a persistent always-available catalog entry for BYO MCP URLs.
- **Initial catalog**: Linear, Notion, Sentry, GitHub, Stripe. All support DCR today.
- **DCR-only for MVP**: providers without DCR are not in the catalog. Pre-registered OAuth clients can be added later with a separate code path.
- **Local-only project**: no redirects for the old `/mcp` → `/connectors` or `/api/admin/mcp-connections` → `/api/admin/connectors` paths. The rename is a clean break.
- **`/settings/agent-access` is out of scope**, except that this spec must not break it.

## User-facing shape

### Sidebar nav

`SidebarExpanded` — replace the existing `/mcp` entry in `nav-bottom`:

- Label: `Connectors` (was "MCP Connections").
- Icon: Lucide `Plug`. The current inline SVG reads as a calendar; `Plug` is unambiguous.
- Href: `/connectors`.
- Position unchanged: same slot in `nav-bottom`, above Settings.

`SidebarRail` (collapsed mode) gets the same icon with the same href and an aria-label of "Connectors".

### `/connectors` page

Owner-only. Non-owners get `notFound()`, same pattern as today's `/settings/mcp-connections`.

Primary job: review / edit / disconnect what's already installed. Layout mirrors today's list page and reuses the same component structure:

```
<Connectors page>
  <header>
    <h1>Connectors</h1>
    <p>External tools your Platform Agent can call during a chat.</p>
    <AddConnectorButton />   // opens the Add modal
  </header>
  <ConnectorList connections={rows} />
</div>
```

Each row shows: connector icon (from catalog or a generic icon for custom), name, status badge (`active` | `error` | `pending`), last-used timestamp, and actions (Edit, Disconnect). Edit behaviour depends on `authType`:

- `oauth`: Edit opens a minimal dialog showing connection metadata + a "Reconnect" button (re-runs the OAuth flow to refresh tokens / re-authorize).
- `bearer` / custom: Edit opens the existing dialog to change URL/name/token.

**Empty state**: when a company has zero installed connectors, the page auto-opens the Add modal on first visit (detected by checking `connections.length === 0` on the server and rendering the list component with an `autoOpenAddModal` prop). Refreshing the page after that doesn't re-open it — the modal fires once per page mount and closing it is sticky for the session. A subtle "Nothing connected yet" message sits behind it.

### Add connector modal

Two visual states in one dialog (not two separate dialogs):

**State 1 — Browse grid.** Title: "Add a connector". Body: a 3-column grid of catalog tiles. Each tile: icon, name, one-line description. At the bottom of the grid, a full-width "Custom connector (advanced)" tile with a generic icon and the hint "Point at any MCP endpoint".

Clicking a tile transitions the dialog to state 2 via local state — no route change, no second modal.

**State 2 — Details pane.** Header row: icon, name, "← Back" link (returns to state 1). Body: description, docs link (if `docsUrl` set), an auth-mode label ("Signs in via OAuth" or "Requires API key"), and the primary **Connect** button. Below the Connect button, a muted help line with the MCP server URL for transparency.

**Connect button behaviour**:
- `authMode: 'oauth-dcr'`: opens a popup to the authorize URL (see § Auth flow below). Button shows "Connecting…" until the popup returns via `postMessage`, then closes the modal and refreshes the list.
- `authMode: 'bearer'`: swaps the Connect button area for an inline `<Input type="password">` labelled "API key" with a Submit button. On submit, calls the create endpoint, tests the connection, closes on success.
- **Custom connector** tile (id: `'custom'`, synthesised in code — not in the catalog array): state 2 uses today's full form (Name, Server URL, Auth type, Bearer token) under a "Custom connector (advanced)" title.

### Connector details / manage

For already-installed connectors, clicking the row opens a details dialog (distinct from the Add modal) showing:

- Icon, name, installed-at, last-used-at.
- Connection status + `lastErrorMessage` if present.
- **Disconnect** button (destructive variant) — confirms inline, then calls the disconnect endpoint.
- **Reconnect** button for OAuth connections (re-runs the OAuth flow on the same row, replacing tokens).
- Discovered tool count from the most recent health check.

This replaces today's "Edit" dialog as the primary manage surface, though the Edit dialog remains reachable for custom/bearer connectors where URL/name changes make sense.

## Catalog model

New file: `src/lib/connectors/catalog.ts`.

```ts
export type ConnectorCatalogEntry = {
  /** Stable identifier. Used as `catalogId` on the connection row. */
  id: string;
  /** Display name on tiles and list rows. */
  name: string;
  /** One-line description shown on the tile and in details. */
  description: string;
  /** Path to an SVG under `public/connectors/`, e.g. `/connectors/linear.svg`. */
  iconUrl: string;
  /** The MCP server URL. */
  mcpUrl: string;
  /** Which auth flow to offer. */
  authMode: 'oauth-dcr' | 'bearer';
  /** Optional link to the provider's MCP docs. */
  docsUrl?: string;
};

export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] = [
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issues, projects, and comments.',
    iconUrl: '/connectors/linear.svg',
    mcpUrl: 'https://mcp.linear.app/mcp',
    authMode: 'oauth-dcr',
    docsUrl: 'https://linear.app/docs/mcp',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read and write your Notion workspace.',
    iconUrl: '/connectors/notion.svg',
    mcpUrl: 'https://mcp.notion.com/mcp',
    authMode: 'oauth-dcr',
    docsUrl: 'https://developers.notion.com/docs/mcp',
  },
  // Sentry, GitHub, Stripe entries follow the same shape.
] as const;

export function getCatalogEntry(id: string): ConnectorCatalogEntry | null {
  return CONNECTOR_CATALOG.find((e) => e.id === id) ?? null;
}
```

Icons live under `public/connectors/*.svg`. Prefer the provider's own brand SVG where licensing allows, otherwise a monochrome glyph.

**Validation**: a Zod schema mirroring `ConnectorCatalogEntry`, invoked at module load in a `validateCatalog()` call (throws on bad data). Unit-tested. Catches typos when adding a provider without requiring a runtime catch-all.

## Auth flow (MCP OAuth DCR)

One platform implementation used by every `oauth-dcr` catalog entry. Lives at `src/lib/connectors/mcp-oauth.ts` to stay within the harness-boundary rule (no Next.js/Vercel imports — callable from workers later).

### Happy path

1. **User clicks Connect** on a catalog tile.
2. **Client** calls `POST /api/admin/connectors` with `{ catalogId }`. Server inserts a `mcp_connections` row (`status='pending'`, `authType='oauth'`, `catalogId=<id>`, no tokens yet) and returns `{ connection, next: { kind: 'oauth', authorizeUrl } }`.
3. **Server, inside the POST handler:**
   a. Probes `GET <mcpUrl>` unauth'd. Reads `WWW-Authenticate` header and, if present, fetches `/.well-known/oauth-authorization-server` (or the URL the header points at) for the authorization server metadata (`authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `scopes_supported`).
   b. Performs Dynamic Client Registration (`POST <registration_endpoint>` with `redirect_uris`, `token_endpoint_auth_method`, `grant_types`, `application_type: 'web'`). Stores `{client_id, client_secret?}` on the connection inside `credentialsEncrypted` JSON blob.
   c. Generates PKCE (`code_verifier`, `code_challenge`) and a `state` value. Signs `{ connectionId, csrf }` with HMAC + 10-minute TTL; that signed string is the OAuth `state` parameter. Stores the PKCE verifier in a short-lived server-side cache keyed by the signed state (in-memory for single-instance dev; we'll swap for the existing KV when we deploy).
   d. Builds the authorize URL with `client_id`, `response_type=code`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, `scope` (from metadata's `scopes_supported`).
4. **Client** opens a centered popup at `authorizeUrl`. Popup performs provider login + consent.
5. **Provider** redirects the popup to `GET /api/admin/connectors/oauth/callback?code=…&state=…`.
6. **Callback handler:**
   a. Verifies state signature + TTL. Loads the connection row by `connectionId`. Loads the PKCE verifier from cache.
   b. Exchanges the code at `token_endpoint` with `client_id`, `client_secret`, `code_verifier`, `redirect_uri`.
   c. Writes `{ accessToken, refreshToken, expiresAt, tokenType, scope, dcrClientId, dcrClientSecret, authServerMetadata }` into `credentialsEncrypted`. Marks `status='active'`.
   d. Runs the existing "list tools" probe to populate tool count and confirm the token works. On failure, sets `status='error'` + `lastErrorMessage`.
   e. Renders a minimal HTML page that does `window.opener.postMessage({ kind: 'connector-oauth-complete', connectionId, status })` then `window.close()`.
7. **Client** receives the message, closes the Add modal, router-refreshes the list.

### Refresh at tool-call time

The MCP-out client at `src/lib/mcp-out/*` gains a pre-call hook: if `authType === 'oauth'` and `expiresAt < now + 60s`, refresh using `refresh_token` grant at the stored `token_endpoint`. Persist new tokens atomically. If refresh fails (`invalid_grant`), mark `status='error'` with a "Reconnect needed" message and surface the error to the chat turn so the agent can tell the user.

### Disconnect

`POST /api/admin/connectors/:id/disconnect`:

1. If `authType === 'oauth'` and metadata includes a `revocation_endpoint`, best-effort `POST` the refresh token to it. Ignore errors (provider may have already revoked).
2. Delete the row. Audit event `connector.disconnected`.

### Retry / failure states

- DCR fails (e.g., provider doesn't support DCR): the POST handler rolls back the pending row and returns `{ error: 'dcr_unsupported' }`. Client shows "This provider needs manual setup — contact support" (this shouldn't happen for catalog entries; it's a guard against regressions).
- User abandons the authorize popup: the pending row sits with `status='pending'`. A separate cleanup path (out of scope for this spec; note for follow-up) sweeps rows older than 24h.
- Token exchange fails at callback: mark `status='error'`, render an error HTML in the popup with a close button, the row stays and the user can use **Reconnect** from details.

## Data model

### `mcp_connections` extension

Single migration:

- Widen the `authType` check constraint to include `'oauth'` alongside existing `'none'` and `'bearer'`.
- Add `catalogId text NULL` column. No index — queried only per-row.

`credentialsEncrypted` remains a single encrypted blob. The decrypted shape is discriminated by `authType`:

```ts
type CredentialsBearer = { token: string };
type CredentialsOAuth = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;       // ISO-8601
  tokenType: string;       // usually 'Bearer'
  scope: string | null;
  dcrClientId: string;
  dcrClientSecret: string | null;
  authServerMetadata: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint: string | null;
    revocationEndpoint: string | null;
    scopesSupported: string[] | null;
  };
};
```

Encryption envelope unchanged (same key, same algorithm as today). The existing encrypt/decrypt helpers wrap a typed variant.

### No new tables

The PKCE verifier + pending DCR state lives in a process-memory TTL cache (`Map<string, { verifier, createdAt }>`). Acceptable for single-instance dev; when the app deploys behind multiple instances, swap for the Vercel KV binding already used elsewhere. Flagged as a follow-up, not blocking.

## API surface

Rename the whole namespace from `/api/admin/mcp-connections` to `/api/admin/connectors`. Reason: the resource is no longer "an MCP connection," it's "a connector." Also matches the frontend's language.

### Endpoints

- `POST /api/admin/connectors`
  - Body variants (discriminated by presence of `catalogId`):
    - `{ catalogId: 'linear' }` — install from catalog. Runs DCR probe for `oauth-dcr` entries; for `bearer` entries, expects `{ catalogId, bearerToken }` in the same call.
    - `{ name, serverUrl, authType: 'none' | 'bearer', bearerToken? }` — custom connector.
  - Returns `{ connection, next: { kind: 'done' | 'oauth', authorizeUrl? } }`.

- `GET /api/admin/connectors/oauth/callback?code&state`
  - Completes OAuth. Renders HTML that posts a message to `window.opener` and closes.

- `POST /api/admin/connectors/:id/oauth/start`
  - Regenerates a fresh authorize URL for the same connection (used by the "Reconnect" button; also when the user retries a failed OAuth flow).

- `POST /api/admin/connectors/:id/disconnect`
  - Best-effort token revoke + row delete.

- `PATCH /api/admin/connectors/:id` — update name (all types), or URL/auth for custom. Unchanged from today's handler, just renamed.

- `DELETE /api/admin/connectors/:id` — keep as an alias for disconnect; same handler.

- `GET /api/admin/connectors` — existing, renamed. Returns the same shape the server page component calls directly today.

All endpoints require Owner role (`requireRole(ctx, 'owner')`).

### Harness boundary

Per `AGENTS.md`, the MCP OAuth client (`src/lib/connectors/mcp-oauth.ts`) and the OAuth token-refresh path called from tool invocation must have zero `next/*` or `@vercel/functions` imports. Route handlers in `src/app/api/admin/connectors/**` do the HTTP translation and call into the pure module. The Edit/Read tool that inspects `src/lib/agent/` would reject a violation — same discipline here.

## Components

New:

- `src/components/connectors/add-connector-dialog.tsx` — two-state dialog (browse grid ↔ details pane). Handles popup + postMessage.
- `src/components/connectors/connector-tile.tsx` — grid tile. Used for catalog entries + the custom tile.
- `src/components/connectors/connector-details-dialog.tsx` — view installed connector, reconnect/disconnect.
- `src/components/connectors/connector-list.tsx` — rewrite of `components/settings/mcp-connection-list.tsx` with icons and richer row UI.
- `src/lib/connectors/catalog.ts` — catalog data + validator.
- `src/lib/connectors/mcp-oauth.ts` — DCR, PKCE, authorize-URL builder, token exchange, refresh.
- `src/app/(app)/connectors/page.tsx` — server component, owner-gated, renders the list + AddConnectorDialog.

Renamed / deleted:

- `src/app/(app)/settings/mcp-connections/page.tsx` — delete. Nothing references it after the sidebar change.
- `src/components/settings/mcp-connection-dialog.tsx` — kept, referenced by the "Custom connector" path and by Edit on bearer connections. Moved to `components/connectors/custom-connector-dialog.tsx` for naming consistency.
- `src/components/settings/mcp-connection-list.tsx` — delete after `ConnectorList` replaces it.
- `/api/admin/mcp-connections/**` routes — rename to `/api/admin/connectors/**`.

## Testing strategy

### Unit

- Catalog schema validation: bad entries throw at module load.
- PKCE code generation: verifier is 43–128 chars, URL-safe; challenge is SHA-256 + base64url of verifier.
- State signing/verification: tampered states reject; expired states reject.
- Token-refresh decision logic: refresh when `expiresAt < now + 60s`, skip otherwise, propagate `invalid_grant` as a typed error.
- `getCatalogEntry` returns null on unknown id.

### Integration

- POST `/api/admin/connectors` with `{ catalogId: 'linear' }` against a fake DCR server (nock or undici mock) — asserts DCR call, metadata fetch, pending row written, authorize URL format.
- GET `/api/admin/connectors/oauth/callback` — exchanges code against the fake server, writes tokens, marks active, probes tools.
- Custom connector create — unchanged behaviour, smoke-tested after the rename.
- Disconnect with `revocation_endpoint` present / absent.
- Owner-role guard on every new endpoint.

### Manual (pre-ship)

- Full OAuth flow against **Linear** (simplest real DCR target; also supports bearer API keys as a debugging fallback). Verify: popup opens, consent screen appears, popup closes on success, row appears in list with active status, a chat turn can invoke a Linear tool.
- First-visit empty-state auto-opens Add modal; second visit doesn't.
- Reconnect on an errored connection clears the error.
- Disconnect removes the row and clears the agent's tool inventory for the next chat turn.

## Open questions (non-blocking)

- **PKCE cache backing** — in-memory for dev, KV for production. Which KV binding? Follow-up ticket.
- **Icon sourcing** — use brand SVGs or monochrome glyphs? Decide per provider; default monochrome to avoid licensing friction.
- **Rate limiting on OAuth start** — no rate limit today. Probably not necessary for an Owner-only endpoint, but worth noting.
- **Pending-row sweeper** — rows stuck in `status='pending'` need a cleanup job. Out of scope for this spec.

## Out of scope (explicit)

- `/settings/agent-access` — untouched. Revisit in a follow-up.
- Pre-registered (non-DCR) OAuth clients — not in MVP. A separate code path when a needed provider lacks DCR.
- Per-user connections — company-level only.
- Admin UI for the catalog — it's a code file.
- Search, categories, "recently added" in the browse modal — single flat grid for five tiles.
- Connector-level settings beyond auth (e.g., scope selection, rate limits) — deferred.

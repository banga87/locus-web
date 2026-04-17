# Connectors Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote outbound MCP connections to a sidebar-level `/connectors` surface with a curated catalog (Linear, Notion, Sentry, GitHub, Stripe + Custom) and one-click OAuth via the MCP Dynamic-Client-Registration spec, backed by a pure TS `connectors` module that stays callable from any execution surface.

**Spec:** `docs/superpowers/specs/2026-04-17-connectors-page-design.md`

**Architecture:** Three layers. (1) `src/lib/connectors/` — pure OAuth primitives (PKCE, state signing, metadata resolution, DCR, authorize-URL builder, token exchange, refresh). Zero `next/*` / `@vercel/functions` imports. (2) `src/app/api/admin/connectors/**` — route handlers that translate HTTP into calls on the pure module plus `src/lib/mcp-out/` helpers. (3) `src/app/(app)/connectors/` page + `src/components/connectors/` UI — Owner-gated, modelled on claude.ai's connectors UI. Existing `/api/admin/mcp-connections` routes and `/settings/mcp-connections` page are renamed and deleted.

**Tech Stack:** Next.js 16 App Router, Drizzle + Postgres (`pgEnum` + `pgcrypto`), `@modelcontextprotocol/sdk@^1.29`, Zod, shadcn/radix components, lucide-react icons, Vitest.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `src/db/migrations/0016_connectors.sql` | Hand-written migration: add `'oauth'` to `mcp_connection_auth_type`, add `'pending'` to `mcp_connection_status`, add `catalog_id text` column. |
| `src/lib/connectors/catalog.ts` | Static `CONNECTOR_CATALOG` array + Zod validator + `getCatalogEntry(id)`. |
| `src/lib/connectors/credentials.ts` | Typed JSON envelope for encrypted credentials (`CredentialsBearer` \| `CredentialsOAuth`) + `encode`/`decode` helpers. |
| `src/lib/connectors/pkce.ts` | `generatePkce()` + state signing / verification. |
| `src/lib/connectors/mcp-oauth.ts` | `resolveAuthServerMetadata`, `performDcr`, `buildAuthorizeUrl`, `exchangeCodeForTokens`, `refreshIfNeeded`. Pure — fetch injected. |
| `src/lib/connectors/pkce-store.ts` | In-memory TTL cache for PKCE verifiers keyed by signed state. Single-process for dev. |
| `src/lib/connectors/__tests__/catalog.test.ts` | Validator + `getCatalogEntry` tests. |
| `src/lib/connectors/__tests__/credentials.test.ts` | Encode/decode round-trip. |
| `src/lib/connectors/__tests__/pkce.test.ts` | PKCE + state sign/verify. |
| `src/lib/connectors/__tests__/mcp-oauth.test.ts` | Metadata resolution, DCR, authorize-URL, token exchange, refresh with mock fetch. |
| `src/app/api/admin/connectors/route.ts` | `GET` list + `POST` install (catalog or custom). |
| `src/app/api/admin/connectors/[id]/route.ts` | `GET` / `PATCH` detail. |
| `src/app/api/admin/connectors/[id]/oauth/start/route.ts` | `POST` regenerate authorize URL for reconnect. |
| `src/app/api/admin/connectors/oauth/callback/route.ts` | `GET` OAuth callback — renders postMessage HTML. |
| `src/app/api/admin/connectors/[id]/disconnect/route.ts` | `POST` revoke + delete. |
| `src/app/api/admin/connectors/__tests__/route.test.ts` | Route-level tests. |
| `src/app/(app)/connectors/page.tsx` | Server component, Owner-gated. Renders the list + AddConnectorDialog. |
| `src/components/connectors/connector-types.ts` | Client-side shape of a connector (`ClientConnector`). |
| `src/components/connectors/connector-list.tsx` | Rows with icons, click to open details. |
| `src/components/connectors/connector-tile.tsx` | Grid tile for browse + catalog entry in details pane. |
| `src/components/connectors/add-connector-dialog.tsx` | Two-state dialog (browse ↔ details) + OAuth popup orchestration. |
| `src/components/connectors/connector-details-dialog.tsx` | View + disconnect + reconnect. |
| `src/components/connectors/custom-connector-dialog.tsx` | Moved + renamed from `components/settings/mcp-connection-dialog.tsx`. |
| `public/connectors/*.svg` | Icons: `linear.svg`, `notion.svg`, `sentry.svg`, `github.svg`, `stripe.svg`, `custom.svg`. |

### Modified

| Path | What changes |
|---|---|
| `src/db/schema/mcp-connections.ts` | Add `'oauth'` to `mcpConnectionAuthTypeEnum`, `'pending'` to `mcpConnectionStatusEnum`, add `catalogId` column. |
| `src/lib/mcp-out/types.ts` | Extend `McpConnectionAuthType` with `'oauth'`. Extend `McpConnectionStatus` with `'pending'`. Add `catalogId: string \| null`. |
| `src/lib/mcp-out/connections.ts` | Accept `authType='oauth'`, `catalogId`, encrypted JSON blobs. Add `installFromCatalog`, `updateConnectionCredentials`. |
| `src/lib/mcp-out/client.ts` | On `authType='oauth'`, call `refreshIfNeeded`, re-encrypt new tokens, use `access_token` as Bearer. On `invalid_grant`, flip `status='error'`. |
| `src/components/shell/sidebar/sidebar-expanded.tsx` | Replace `/mcp` link + "MCP Connections" label + SVG with `/connectors` + "Connectors" + Lucide `Plug`. |
| `src/components/shell/sidebar/sidebar-rail.tsx` | Same replacement in collapsed rail. |
| `scripts/apply-custom-migrations.ts` | Append `'0016_connectors.sql'` to the migration list. |

### Deleted

| Path | Reason |
|---|---|
| `src/app/(app)/settings/mcp-connections/page.tsx` | Replaced by `/connectors/page.tsx`. Nothing links here after the sidebar swap. |
| `src/app/api/admin/mcp-connections/**` | Renamed to `/api/admin/connectors/**`. Local-only project → no redirect. |
| `src/components/settings/mcp-connection-dialog.tsx` | Moved to `components/connectors/custom-connector-dialog.tsx`. |
| `src/components/settings/mcp-connection-list.tsx` | Replaced by `components/connectors/connector-list.tsx`. |
| `src/components/settings/mcp-connection-types.ts` | Replaced by `components/connectors/connector-types.ts`. |

---

## Task 1: Schema + migration

**Files:**
- Create: `src/db/migrations/0016_connectors.sql`
- Modify: `src/db/schema/mcp-connections.ts`
- Modify: `scripts/apply-custom-migrations.ts`
- Modify: `src/lib/mcp-out/types.ts`

- [ ] **Step 1: Write the migration SQL**

Note: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block. The hand-written migration runner in `scripts/apply-custom-migrations.ts` executes each `-- statement-breakpoint`-separated block as a single `postgres.unsafe()` call, so each `ALTER TYPE` statement must be its own block.

Create `src/db/migrations/0016_connectors.sql`:

```sql
-- Migration 0016: Connectors page — adds OAuth authType, pending status,
-- and catalog_id column to mcp_connections.
--
-- ALTER TYPE ADD VALUE cannot run inside a transaction block, so each
-- enum addition is its own statement block. IF NOT EXISTS makes re-runs
-- safe under apply-custom-migrations.ts.

ALTER TYPE "mcp_connection_auth_type" ADD VALUE IF NOT EXISTS 'oauth';
--> statement-breakpoint

ALTER TYPE "mcp_connection_status" ADD VALUE IF NOT EXISTS 'pending';
--> statement-breakpoint

ALTER TABLE "mcp_connections" ADD COLUMN IF NOT EXISTS "catalog_id" text;
```

- [ ] **Step 2: Register the migration**

Append `'0016_connectors.sql'` to the `CUSTOM_MIGRATIONS` array in `scripts/apply-custom-migrations.ts`.

- [ ] **Step 3: Update the Drizzle schema**

In `src/db/schema/mcp-connections.ts`:

```ts
export const mcpConnectionAuthTypeEnum = pgEnum('mcp_connection_auth_type', [
  'none',
  'bearer',
  'oauth',
]);

export const mcpConnectionStatusEnum = pgEnum('mcp_connection_status', [
  'active',
  'disabled',
  'error',
  'pending',
]);
```

Add the column inside the `pgTable` block, after `lastErrorMessage`:

```ts
catalogId: text('catalog_id'),
```

- [ ] **Step 4: Update the TS types**

In `src/lib/mcp-out/types.ts`:

```ts
export type McpConnectionAuthType = 'none' | 'bearer' | 'oauth';
export type McpConnectionStatus = 'active' | 'disabled' | 'error' | 'pending';

export interface McpConnection {
  id: string;
  companyId: string;
  name: string;
  serverUrl: string;
  authType: McpConnectionAuthType;
  credentialsEncrypted: Buffer | null;
  status: McpConnectionStatus;
  lastErrorMessage: string | null;
  catalogId: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}
```

Update `toConnection` in `connections.ts` to copy `catalogId: row.catalogId ?? null`.

- [ ] **Step 5: Run the migration against the dev DB**

```bash
cd locus-web && npx tsx scripts/apply-custom-migrations.ts
```
Expected: prints "applied 0016_connectors.sql" (or equivalent success message; re-running must succeed idempotently).

- [ ] **Step 6: Typecheck**

```bash
cd locus-web && npx tsc --noEmit
```
Expected: clean. (Any fallout is in `connections.ts` where `toConnection` must return the new `catalogId` field — fix there.)

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/0016_connectors.sql scripts/apply-custom-migrations.ts \
        src/db/schema/mcp-connections.ts src/lib/mcp-out/types.ts \
        src/lib/mcp-out/connections.ts
git commit -m "feat(connectors): schema additions for oauth + pending + catalogId"
```

---

## Task 2: Credentials JSON envelope

**Files:**
- Create: `src/lib/connectors/credentials.ts`
- Create: `src/lib/connectors/__tests__/credentials.test.ts`

Rationale: the existing `encryptCredential(plaintext)` / `decryptCredential(buffer)` helpers accept arbitrary strings. We don't change them; we add a JSON-typed wrapper that lives inside `lib/connectors/` (harness-pure) so both paths (bearer and OAuth) share one serialised shape.

- [ ] **Step 1: Write the failing test**

`src/lib/connectors/__tests__/credentials.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  encodeCredentials,
  decodeCredentials,
  type CredentialsBearer,
  type CredentialsOAuth,
} from '../credentials';

describe('credentials envelope', () => {
  it('round-trips a bearer credential', () => {
    const input: CredentialsBearer = { kind: 'bearer', token: 'sk_live_abc' };
    const encoded = encodeCredentials(input);
    expect(typeof encoded).toBe('string');
    expect(decodeCredentials(encoded)).toEqual(input);
  });

  it('round-trips an oauth credential', () => {
    const input: CredentialsOAuth = {
      kind: 'oauth',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: '2026-04-17T12:00:00.000Z',
      tokenType: 'Bearer',
      scope: 'read write',
      dcrClientId: 'c',
      dcrClientSecret: null,
      authServerMetadata: {
        authorizationEndpoint: 'https://x/authorize',
        tokenEndpoint: 'https://x/token',
        registrationEndpoint: 'https://x/register',
        revocationEndpoint: null,
        scopesSupported: ['read', 'write'],
      },
    };
    expect(decodeCredentials(encodeCredentials(input))).toEqual(input);
  });

  it('rejects an unknown kind', () => {
    expect(() => decodeCredentials('{"kind":"weird"}')).toThrow(/unknown credential kind/);
  });

  it('rejects malformed JSON', () => {
    expect(() => decodeCredentials('not json')).toThrow(/malformed/);
  });
});
```

- [ ] **Step 2: Run the test (fail)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/credentials.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `credentials.ts`**

```ts
// Typed JSON envelope for encrypted credentials. The `kind` discriminator
// is the only field callers need to switch on. Stored as the plaintext
// that encryptCredential() receives — the envelope is inside the
// pgcrypto ciphertext, not next to it.

export interface CredentialsBearer {
  kind: 'bearer';
  token: string;
}

export interface AuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  revocationEndpoint: string | null;
  scopesSupported: string[] | null;
}

export interface CredentialsOAuth {
  kind: 'oauth';
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO-8601
  tokenType: string;
  scope: string | null;
  dcrClientId: string;
  dcrClientSecret: string | null;
  authServerMetadata: AuthServerMetadata;
}

export type Credentials = CredentialsBearer | CredentialsOAuth;

export function encodeCredentials(c: Credentials): string {
  return JSON.stringify(c);
}

export function decodeCredentials(raw: string): Credentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('malformed credentials JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) {
    throw new Error('malformed credentials JSON');
  }
  const kind = (parsed as { kind: unknown }).kind;
  if (kind !== 'bearer' && kind !== 'oauth') {
    throw new Error(`unknown credential kind: ${String(kind)}`);
  }
  return parsed as Credentials;
}
```

- [ ] **Step 4: Run the test (pass)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/credentials.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connectors/credentials.ts src/lib/connectors/__tests__/credentials.test.ts
git commit -m "feat(connectors): typed JSON envelope for credentials"
```

---

## Task 3: Catalog module

**Files:**
- Create: `src/lib/connectors/catalog.ts`
- Create: `src/lib/connectors/__tests__/catalog.test.ts`
- Create: `public/connectors/{linear,notion,sentry,github,stripe,custom}.svg`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_CATALOG,
  getCatalogEntry,
  validateCatalog,
} from '../catalog';

describe('connector catalog', () => {
  it('loads with known entries', () => {
    const ids = CONNECTOR_CATALOG.map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining(['linear', 'notion', 'sentry', 'github', 'stripe']),
    );
  });

  it('returns null for unknown ids', () => {
    expect(getCatalogEntry('does-not-exist')).toBeNull();
  });

  it('returns the entry for a known id', () => {
    const entry = getCatalogEntry('linear');
    expect(entry?.name).toBe('Linear');
    expect(entry?.mcpUrl).toMatch(/^https:\/\//);
  });

  it('rejects a duplicate id', () => {
    const dup = [
      { id: 'x', name: 'X', description: 'd', iconUrl: '/a.svg', mcpUrl: 'https://a', authMode: 'oauth-dcr' as const },
      { id: 'x', name: 'X2', description: 'd', iconUrl: '/b.svg', mcpUrl: 'https://b', authMode: 'oauth-dcr' as const },
    ];
    expect(() => validateCatalog(dup)).toThrow(/duplicate/);
  });

  it('rejects an unknown authMode', () => {
    const bad = [
      { id: 'x', name: 'X', description: 'd', iconUrl: '/a.svg', mcpUrl: 'https://a', authMode: 'weird' },
    ];
    expect(() => validateCatalog(bad as unknown as Parameters<typeof validateCatalog>[0])).toThrow();
  });
});
```

- [ ] **Step 2: Run the test (fail)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/catalog.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `catalog.ts`**

```ts
import { z } from 'zod';

export const CatalogEntrySchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  iconUrl: z.string().startsWith('/'),
  mcpUrl: z.string().url(),
  authMode: z.enum(['oauth-dcr', 'bearer']),
  docsUrl: z.string().url().optional(),
});

export type ConnectorCatalogEntry = z.infer<typeof CatalogEntrySchema>;

export function validateCatalog(entries: unknown): ConnectorCatalogEntry[] {
  const parsed = z.array(CatalogEntrySchema).parse(entries);
  const seen = new Set<string>();
  for (const e of parsed) {
    if (seen.has(e.id)) {
      throw new Error(`duplicate catalog id: ${e.id}`);
    }
    seen.add(e.id);
  }
  return parsed;
}

const RAW_ENTRIES: ConnectorCatalogEntry[] = [
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
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Errors, issues, and performance traces.',
    iconUrl: '/connectors/sentry.svg',
    mcpUrl: 'https://mcp.sentry.dev/mcp',
    authMode: 'oauth-dcr',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repos, issues, and pull requests.',
    iconUrl: '/connectors/github.svg',
    mcpUrl: 'https://api.githubcopilot.com/mcp/',
    authMode: 'oauth-dcr',
    docsUrl: 'https://docs.github.com/en/copilot/using-github-copilot/coding-agent/mcp-server',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payments, customers, and subscriptions.',
    iconUrl: '/connectors/stripe.svg',
    mcpUrl: 'https://mcp.stripe.com',
    authMode: 'oauth-dcr',
    docsUrl: 'https://docs.stripe.com/mcp',
  },
];

// Validate at module load — typos or schema drift crash the dev server.
export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] =
  Object.freeze(validateCatalog(RAW_ENTRIES));

export function getCatalogEntry(id: string): ConnectorCatalogEntry | null {
  return CONNECTOR_CATALOG.find((e) => e.id === id) ?? null;
}
```

- [ ] **Step 4: Create placeholder SVG icons**

Write a minimal monochrome placeholder to each of `public/connectors/{linear,notion,sentry,github,stripe,custom}.svg`. Real brand SVGs can replace these later; the test suite only asserts `iconUrl` starts with `/`. Example `public/connectors/custom.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 9h6M9 13h6M9 17h4"/></svg>
```

- [ ] **Step 5: Run the test (pass)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/catalog.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/connectors/catalog.ts src/lib/connectors/__tests__/catalog.test.ts public/connectors/
git commit -m "feat(connectors): static catalog with Zod validator + icon placeholders"
```

---

## Task 4: PKCE + state signing primitives

**Files:**
- Create: `src/lib/connectors/pkce.ts`
- Create: `src/lib/connectors/__tests__/pkce.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import {
  generatePkce,
  signState,
  verifyState,
} from '../pkce';

const SECRET = randomBytes(32).toString('hex');

describe('generatePkce', () => {
  it('produces a URL-safe verifier ≥ 43 chars', () => {
    const { verifier } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('challenge = base64url(sha256(verifier))', () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });
});

describe('signState / verifyState', () => {
  it('round-trips a payload', () => {
    const state = signState({ connectionId: 'abc', csrf: 'def' }, SECRET, 600);
    const verified = verifyState(state, SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.connectionId).toBe('abc');
      expect(verified.payload.csrf).toBe('def');
    }
  });

  it('rejects tampered state', () => {
    const state = signState({ connectionId: 'abc', csrf: 'def' }, SECRET, 600);
    const tampered = state.slice(0, -1) + (state.slice(-1) === 'a' ? 'b' : 'a');
    const verified = verifyState(tampered, SECRET);
    expect(verified.ok).toBe(false);
  });

  it('rejects a state signed with a different secret', () => {
    const state = signState({ connectionId: 'abc', csrf: 'def' }, SECRET, 600);
    const verified = verifyState(state, 'f'.repeat(64));
    expect(verified.ok).toBe(false);
  });

  it('rejects an expired state', () => {
    const state = signState({ connectionId: 'abc', csrf: 'def' }, SECRET, -1);
    const verified = verifyState(state, SECRET);
    expect(verified.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test (fail)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/pkce.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pkce.ts`**

```ts
// PKCE code generator + HMAC-signed state helper.
//
// `signState` embeds an expiry in the payload so `verifyState` can reject
// stale states without a server-side cache lookup. The signing secret
// lives in CONNECTORS_STATE_SECRET (32-byte hex).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function generatePkce(): PkcePair {
  // 64 random bytes → 86 base64url chars, within the 43–128 spec window.
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface StatePayload {
  connectionId: string;
  csrf: string;
}

interface SignedState {
  payload: StatePayload;
  expiresAt: number; // epoch seconds
}

export function signState(
  payload: StatePayload,
  secretHex: string,
  ttlSeconds: number,
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body: SignedState = { payload, expiresAt };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyState(state: string, secretHex: string): VerifyResult {
  const parts = state.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [encoded, sig] = parts;

  const expected = createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let body: SignedState;
  try {
    body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (body.expiresAt < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload: body.payload };
}
```

- [ ] **Step 4: Run the test (pass)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/pkce.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connectors/pkce.ts src/lib/connectors/__tests__/pkce.test.ts
git commit -m "feat(connectors): PKCE + HMAC-signed state helper"
```

---

## Task 5: OAuth metadata resolution + DCR

**Files:**
- Create: `src/lib/connectors/mcp-oauth.ts` (partial — metadata + DCR only)
- Create: `src/lib/connectors/__tests__/mcp-oauth.test.ts`

- [ ] **Step 1: Write the failing test for metadata resolution**

`src/lib/connectors/__tests__/mcp-oauth.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  resolveAuthServerMetadata,
  performDcr,
  type AuthServerMetadata,
} from '../mcp-oauth';

const META: AuthServerMetadata = {
  authorizationEndpoint: 'https://provider/authorize',
  tokenEndpoint: 'https://provider/token',
  registrationEndpoint: 'https://provider/register',
  revocationEndpoint: null,
  scopesSupported: null,
};

function fetchMock(responses: Array<{ urlMatch: RegExp; init: ResponseInit; body: unknown }>) {
  return vi.fn(async (input: string | URL) => {
    const url = input.toString();
    const match = responses.find((r) => r.urlMatch.test(url));
    if (!match) throw new Error(`unexpected fetch: ${url}`);
    return new Response(JSON.stringify(match.body), match.init);
  });
}

describe('resolveAuthServerMetadata', () => {
  it('follows WWW-Authenticate resource_metadata', async () => {
    const fetchFn = fetchMock([
      {
        urlMatch: /mcp\.provider\/mcp$/,
        init: {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://provider/.well-known/oauth-authorization-server"' },
        },
        body: {},
      },
      {
        urlMatch: /\.well-known\/oauth-authorization-server$/,
        init: { status: 200, headers: {} },
        body: {
          authorization_endpoint: META.authorizationEndpoint,
          token_endpoint: META.tokenEndpoint,
          registration_endpoint: META.registrationEndpoint,
        },
      },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.metadata.tokenEndpoint).toBe(META.tokenEndpoint);
  });

  it('falls back to origin /.well-known when WWW-Authenticate is absent', async () => {
    const fetchFn = fetchMock([
      {
        urlMatch: /mcp\.provider\/mcp$/,
        init: { status: 401, headers: {} },
        body: {},
      },
      {
        urlMatch: /^https:\/\/mcp\.provider\/\.well-known\/oauth-authorization-server$/,
        init: { status: 200, headers: {} },
        body: {
          authorization_endpoint: META.authorizationEndpoint,
          token_endpoint: META.tokenEndpoint,
          registration_endpoint: META.registrationEndpoint,
        },
      },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(true);
  });

  it('returns dcr_unsupported when both paths fail', async () => {
    const fetchFn = fetchMock([
      { urlMatch: /mcp\.provider\/mcp$/, init: { status: 401, headers: {} }, body: {} },
      { urlMatch: /\.well-known/, init: { status: 404, headers: {} }, body: {} },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('dcr_unsupported');
  });

  it('returns dcr_unsupported when metadata lacks required fields', async () => {
    const fetchFn = fetchMock([
      { urlMatch: /mcp\.provider\/mcp$/, init: { status: 401, headers: {} }, body: {} },
      {
        urlMatch: /\.well-known/,
        init: { status: 200, headers: {} },
        body: { authorization_endpoint: META.authorizationEndpoint }, // missing token + registration
      },
    ]);
    const result = await resolveAuthServerMetadata(new URL('https://mcp.provider/mcp'), fetchFn);
    expect(result.ok).toBe(false);
  });
});

describe('performDcr', () => {
  it('registers a client with PKCE + authorization_code', async () => {
    const captured: { body?: unknown } = {};
    const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      captured.body = JSON.parse((init?.body as string) ?? '{}');
      return new Response(
        JSON.stringify({ client_id: 'cid', client_secret: 'csec' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await performDcr(
      META,
      { redirectUri: 'https://locus.local/cb', clientName: 'Locus' },
      fetchFn,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clientId).toBe('cid');
      expect(result.clientSecret).toBe('csec');
    }
    const body = captured.body as Record<string, unknown>;
    expect(body.redirect_uris).toEqual(['https://locus.local/cb']);
    expect(body.grant_types).toContain('authorization_code');
    expect(body.grant_types).toContain('refresh_token');
  });

  it('returns an error on non-2xx', async () => {
    const fetchFn = vi.fn(
      async () => new Response('{"error":"invalid_redirect"}', { status: 400 }),
    );
    const result = await performDcr(
      META,
      { redirectUri: 'https://locus.local/cb', clientName: 'Locus' },
      fetchFn,
    );
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test (fail)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/mcp-oauth.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resolveAuthServerMetadata` + `performDcr`**

Create `src/lib/connectors/mcp-oauth.ts`:

```ts
// MCP OAuth client primitives. Pure — fetch is injectable so tests can
// stub it and no Next.js / @vercel/functions import ever shows up here.
// Follows the MCP auth spec (2025-03-26) + RFC 7591 (DCR) + RFC 8414
// (authorization server metadata).

import type { AuthServerMetadata as AuthServerMetadataType } from './credentials';

export type AuthServerMetadata = AuthServerMetadataType;

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

// --- resolveAuthServerMetadata -----------------------------------------

export type ResolveResult =
  | { ok: true; metadata: AuthServerMetadata }
  | { ok: false; error: 'dcr_unsupported'; detail?: string };

/**
 * Probe the MCP endpoint for OAuth 2.1 metadata.
 *
 * Order:
 *  1. If the unauthenticated `GET <mcpUrl>` returns `WWW-Authenticate`
 *     with `resource_metadata=` or `as_uri=`, fetch that URL.
 *  2. Otherwise, fetch `<origin>/.well-known/oauth-authorization-server`.
 *  3. If both fail or the metadata lacks required fields, return
 *     `dcr_unsupported`.
 */
export async function resolveAuthServerMetadata(
  mcpUrl: URL,
  fetchFn: FetchLike = fetch,
): Promise<ResolveResult> {
  let probe: Response;
  try {
    probe = await fetchFn(mcpUrl);
  } catch (err) {
    return {
      ok: false,
      error: 'dcr_unsupported',
      detail: err instanceof Error ? err.message : 'probe failed',
    };
  }

  const metaUrl =
    extractMetadataUrl(probe.headers.get('www-authenticate')) ??
    new URL('/.well-known/oauth-authorization-server', mcpUrl).toString();

  let metaRes: Response;
  try {
    metaRes = await fetchFn(metaUrl);
  } catch {
    return { ok: false, error: 'dcr_unsupported', detail: 'metadata fetch failed' };
  }
  if (!metaRes.ok) {
    return { ok: false, error: 'dcr_unsupported', detail: `metadata HTTP ${metaRes.status}` };
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await metaRes.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'dcr_unsupported', detail: 'metadata not JSON' };
  }

  const authorizationEndpoint = raw.authorization_endpoint;
  const tokenEndpoint = raw.token_endpoint;
  const registrationEndpoint = raw.registration_endpoint ?? null;
  if (
    typeof authorizationEndpoint !== 'string' ||
    typeof tokenEndpoint !== 'string' ||
    (registrationEndpoint !== null && typeof registrationEndpoint !== 'string')
  ) {
    return { ok: false, error: 'dcr_unsupported', detail: 'required fields missing' };
  }
  if (!registrationEndpoint) {
    return { ok: false, error: 'dcr_unsupported', detail: 'registration_endpoint missing' };
  }

  return {
    ok: true,
    metadata: {
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint,
      revocationEndpoint:
        typeof raw.revocation_endpoint === 'string' ? raw.revocation_endpoint : null,
      scopesSupported:
        Array.isArray(raw.scopes_supported) && raw.scopes_supported.every((s) => typeof s === 'string')
          ? (raw.scopes_supported as string[])
          : null,
    },
  };
}

function extractMetadataUrl(header: string | null): string | null {
  if (!header) return null;
  // Look for either `resource_metadata="..."` or `as_uri="..."`.
  const m = /(?:resource_metadata|as_uri)="([^"]+)"/i.exec(header);
  return m?.[1] ?? null;
}

// --- performDcr --------------------------------------------------------

export type DcrResult =
  | { ok: true; clientId: string; clientSecret: string | null }
  | { ok: false; error: string };

export async function performDcr(
  metadata: AuthServerMetadata,
  opts: { redirectUri: string; clientName: string },
  fetchFn: FetchLike = fetch,
): Promise<DcrResult> {
  if (!metadata.registrationEndpoint) {
    return { ok: false, error: 'no registration endpoint' };
  }
  const res = await fetchFn(metadata.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: opts.clientName,
      redirect_uris: [opts.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
      application_type: 'web',
    }),
  });
  if (!res.ok) {
    return { ok: false, error: `DCR HTTP ${res.status}` };
  }
  const body = (await res.json()) as Record<string, unknown>;
  const clientId = body.client_id;
  if (typeof clientId !== 'string') {
    return { ok: false, error: 'DCR response missing client_id' };
  }
  return {
    ok: true,
    clientId,
    clientSecret: typeof body.client_secret === 'string' ? body.client_secret : null,
  };
}
```

- [ ] **Step 4: Run the test (pass)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/mcp-oauth.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connectors/mcp-oauth.ts src/lib/connectors/__tests__/mcp-oauth.test.ts
git commit -m "feat(connectors): resolveAuthServerMetadata + performDcr"
```

---

## Task 6: Authorize URL + token exchange + refresh

**Files:**
- Modify: `src/lib/connectors/mcp-oauth.ts`
- Modify: `src/lib/connectors/__tests__/mcp-oauth.test.ts`

- [ ] **Step 1: Extend the failing tests**

Append to `src/lib/connectors/__tests__/mcp-oauth.test.ts`:

```ts
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshIfNeeded,
} from '../mcp-oauth';
import type { CredentialsOAuth } from '../credentials';

describe('buildAuthorizeUrl', () => {
  it('includes PKCE + required params', () => {
    const url = buildAuthorizeUrl(META, {
      clientId: 'cid',
      redirectUri: 'https://locus.local/cb',
      scope: 'read write',
      state: 'sig.state',
      codeChallenge: 'chal',
    });
    expect(url).toMatch(/https:\/\/provider\/authorize/);
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe('https://locus.local/cb');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('sig.state');
    expect(u.searchParams.get('code_challenge')).toBe('chal');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe('read write');
  });
});

describe('exchangeCodeForTokens', () => {
  it('posts the right body and maps the response', async () => {
    let capturedBody = '';
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? '';
      return new Response(
        JSON.stringify({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'read',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const result = await exchangeCodeForTokens(
      META,
      {
        clientId: 'cid',
        clientSecret: 'csec',
        code: 'the-code',
        codeVerifier: 'the-verifier',
        redirectUri: 'https://locus.local/cb',
      },
      fetchFn,
    );
    expect(result.ok).toBe(true);
    const params = new URLSearchParams(capturedBody);
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('the-code');
    expect(params.get('code_verifier')).toBe('the-verifier');
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('at');
      expect(result.tokens.refreshToken).toBe('rt');
      expect(new Date(result.tokens.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
  });
});

describe('refreshIfNeeded', () => {
  function makeCreds(offsetMs: number): CredentialsOAuth {
    return {
      kind: 'oauth',
      accessToken: 'old-at',
      refreshToken: 'rt',
      expiresAt: new Date(Date.now() + offsetMs).toISOString(),
      tokenType: 'Bearer',
      scope: null,
      dcrClientId: 'cid',
      dcrClientSecret: 'csec',
      authServerMetadata: META,
    };
  }

  it('returns unchanged when far from expiry', async () => {
    const fetchFn = vi.fn();
    const result = await refreshIfNeeded(makeCreds(10 * 60_000), new Date(), fetchFn);
    expect(result.kind).toBe('unchanged');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refreshes when within 60s of expiry', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'new-at',
            refresh_token: 'new-rt',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: {} },
        ),
    );
    const result = await refreshIfNeeded(makeCreds(30_000), new Date(), fetchFn);
    expect(result.kind).toBe('refreshed');
    if (result.kind === 'refreshed') {
      expect(result.credentials.accessToken).toBe('new-at');
      expect(result.credentials.refreshToken).toBe('new-rt');
    }
  });

  it('returns invalid_grant on 400', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('{"error":"invalid_grant"}', { status: 400, headers: {} }),
    );
    const result = await refreshIfNeeded(makeCreds(30_000), new Date(), fetchFn);
    expect(result.kind).toBe('invalid_grant');
  });
});
```

- [ ] **Step 2: Run tests (fail)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/mcp-oauth.test.ts
```
Expected: FAIL — the three new exports aren't defined.

- [ ] **Step 3: Implement the three functions**

Append to `src/lib/connectors/mcp-oauth.ts`:

```ts
// --- buildAuthorizeUrl -------------------------------------------------

export function buildAuthorizeUrl(
  metadata: AuthServerMetadata,
  opts: {
    clientId: string;
    redirectUri: string;
    scope: string | null;
    state: string;
    codeChallenge: string;
  },
): string {
  const u = new URL(metadata.authorizationEndpoint);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', opts.state);
  u.searchParams.set('code_challenge', opts.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (opts.scope) u.searchParams.set('scope', opts.scope);
  return u.toString();
}

// --- exchangeCodeForTokens --------------------------------------------

import type { CredentialsOAuth } from './credentials';

type TokenResponseMapped = Omit<CredentialsOAuth, 'kind' | 'dcrClientId' | 'dcrClientSecret' | 'authServerMetadata'>;

export type ExchangeResult =
  | { ok: true; tokens: TokenResponseMapped }
  | { ok: false; error: string };

export async function exchangeCodeForTokens(
  metadata: AuthServerMetadata,
  opts: {
    clientId: string;
    clientSecret: string | null;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
  fetchFn: FetchLike = fetch,
): Promise<ExchangeResult> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    code_verifier: opts.codeVerifier,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
  });
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (opts.clientSecret) {
    headers.authorization =
      'Basic ' +
      Buffer.from(`${encodeURIComponent(opts.clientId)}:${encodeURIComponent(opts.clientSecret)}`).toString(
        'base64',
      );
  }
  const res = await fetchFn(metadata.tokenEndpoint, {
    method: 'POST',
    headers,
    body: params.toString(),
  });
  if (!res.ok) {
    return { ok: false, error: `token HTTP ${res.status}` };
  }
  const body = (await res.json()) as Record<string, unknown>;
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  const expiresIn = body.expires_in;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    return { ok: false, error: 'token response missing tokens' };
  }
  const expiresSeconds = typeof expiresIn === 'number' ? expiresIn : 3600;
  return {
    ok: true,
    tokens: {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresSeconds * 1000).toISOString(),
      tokenType: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
      scope: typeof body.scope === 'string' ? body.scope : null,
    },
  };
}

// --- refreshIfNeeded ---------------------------------------------------

export type RefreshResult =
  | { kind: 'unchanged' }
  | { kind: 'refreshed'; credentials: CredentialsOAuth }
  | { kind: 'invalid_grant'; error: string };

const REFRESH_SKEW_MS = 60_000;

export async function refreshIfNeeded(
  creds: CredentialsOAuth,
  now: Date,
  fetchFn: FetchLike = fetch,
): Promise<RefreshResult> {
  const expiresAt = new Date(creds.expiresAt).getTime();
  if (expiresAt - now.getTime() > REFRESH_SKEW_MS) {
    return { kind: 'unchanged' };
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.dcrClientId,
  });
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (creds.dcrClientSecret) {
    headers.authorization =
      'Basic ' +
      Buffer.from(`${encodeURIComponent(creds.dcrClientId)}:${encodeURIComponent(creds.dcrClientSecret)}`).toString(
        'base64',
      );
  }
  const res = await fetchFn(creds.authServerMetadata.tokenEndpoint, {
    method: 'POST',
    headers,
    body: params.toString(),
  });
  if (res.status === 400 || res.status === 401) {
    return { kind: 'invalid_grant', error: `refresh HTTP ${res.status}` };
  }
  if (!res.ok) {
    return { kind: 'invalid_grant', error: `refresh HTTP ${res.status}` };
  }
  const body = (await res.json()) as Record<string, unknown>;
  const accessToken = body.access_token;
  if (typeof accessToken !== 'string') {
    return { kind: 'invalid_grant', error: 'refresh response missing access_token' };
  }
  const expiresSeconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  return {
    kind: 'refreshed',
    credentials: {
      ...creds,
      accessToken,
      // RFC 6749 §6: refresh response MAY include a new refresh_token.
      // If absent, keep the old one.
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : creds.refreshToken,
      expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
      tokenType: typeof body.token_type === 'string' ? body.token_type : creds.tokenType,
      scope: typeof body.scope === 'string' ? body.scope : creds.scope,
    },
  };
}
```

- [ ] **Step 4: Run tests (pass)**

```bash
cd locus-web && npx vitest run src/lib/connectors/__tests__/mcp-oauth.test.ts
```
Expected: PASS.

- [ ] **Step 5: Extend the harness boundary check to `src/lib/connectors/`**

Today `scripts/check-harness-boundary.sh` only scans `src/lib/agent/`. Extend it so `src/lib/connectors/` is also checked — same forbidden imports (`next/*`, `@vercel/functions`). Concretely, duplicate the `TARGET_DIR` check + grep block for a second target, or refactor into a loop over `("src/lib/agent" "src/lib/connectors")`. Commit the script change in the same commit as this task. Also extend the ESLint `no-restricted-imports` rule in `eslint.config.mjs` to cover `src/lib/connectors/**/*.ts`.

Then run:

```bash
cd locus-web && bash scripts/check-harness-boundary.sh
cd locus-web && npm run lint
```
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/connectors/mcp-oauth.ts src/lib/connectors/__tests__/mcp-oauth.test.ts \
        scripts/check-harness-boundary.sh eslint.config.mjs
git commit -m "feat(connectors): authorize URL + token exchange + refresh + boundary check"
```

---

## Task 7: PKCE verifier store

**Files:**
- Create: `src/lib/connectors/pkce-store.ts`

Single-process in-memory TTL map. The spec notes this is a dev-only substrate; swapping for a KV-backed store is a follow-up.

- [ ] **Step 1: Implement the store**

```ts
// Short-lived PKCE verifier store. Keyed by signed-state string; values
// auto-expire after 10 minutes. Single-process only — safe for dev, will
// need KV in a multi-instance deploy.

interface Entry {
  verifier: string;
  expiresAt: number;
}

const store = new Map<string, Entry>();
const TTL_MS = 10 * 60_000;

export function savePkceVerifier(signedState: string, verifier: string): void {
  sweep();
  store.set(signedState, { verifier, expiresAt: Date.now() + TTL_MS });
}

export function takePkceVerifier(signedState: string): string | null {
  sweep();
  const entry = store.get(signedState);
  if (!entry) return null;
  store.delete(signedState);
  if (entry.expiresAt < Date.now()) return null;
  return entry.verifier;
}

function sweep(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt < now) store.delete(k);
  }
}

// Testing hook — not for production use.
export function __resetPkceStoreForTests(): void {
  store.clear();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/connectors/pkce-store.ts
git commit -m "feat(connectors): in-memory PKCE verifier store"
```

---

## Task 8: Rename `/api/admin/mcp-connections` → `/api/admin/connectors`

**Files:**
- Rename directory: `src/app/api/admin/mcp-connections/` → `src/app/api/admin/connectors/`
- Modify: everything inside that renames, plus frontend fetch calls that point at the old path.

Keep behaviour identical in this task. Extending the POST to accept `catalogId` happens in Task 9.

- [ ] **Step 1: Move the route directory**

```bash
cd locus-web && git mv src/app/api/admin/mcp-connections src/app/api/admin/connectors
```

- [ ] **Step 2: Find and fix old-path fetch calls**

```bash
cd locus-web && grep -rn "/api/admin/mcp-connections" src/ --include='*.ts' --include='*.tsx'
```
Expected: matches in `src/components/settings/mcp-connection-dialog.tsx` and `src/components/settings/mcp-connection-list.tsx`. Replace every occurrence with `/api/admin/connectors`. (These files get renamed in later tasks; doing the URL swap now keeps the rename atomic.)

- [ ] **Step 3: Typecheck + run the route tests**

```bash
cd locus-web && npx tsc --noEmit
cd locus-web && npx vitest run src/app/api/admin/connectors/__tests__/route.test.ts
```
Expected: typecheck clean, tests pass unchanged (they still reference the imports relatively).

- [ ] **Step 4: Commit**

```bash
git add -A src/app/api/admin/connectors src/components/settings
git commit -m "refactor(connectors): rename /api/admin/mcp-connections → /api/admin/connectors"
```

---

## Task 9: Extend `POST /api/admin/connectors` with catalog install + OAuth kickoff

**Files:**
- Modify: `src/app/api/admin/connectors/route.ts`
- Modify: `src/lib/mcp-out/connections.ts` (add `installFromCatalog`)
- Modify: `src/app/api/admin/connectors/__tests__/route.test.ts`

- [ ] **Step 0: Add `CONNECTORS_STATE_SECRET` to `.env.local`**

```
CONNECTORS_STATE_SECRET=<run: openssl rand -hex 32>
```

Document next to `MCP_CONNECTION_ENCRYPTION_KEY` in whatever env example file exists. The kickoff helper throws if this is unset, so any manual testing in Step 6 will fail without it.

- [ ] **Step 1: Add `installFromCatalog` to `connections.ts`**

In `src/lib/mcp-out/connections.ts`, add (no new imports needed — `encryptCredential` is defined in the same file, `mcpConnections` is already imported, `and`/`eq` are already imported):

```ts
export interface InstallFromCatalogInput {
  companyId: string;
  catalogId: string;
  name: string;
  serverUrl: string;
  authType: McpConnectionAuthType; // 'oauth' or 'bearer'
  /** Encrypted credentials blob (JSON string, then pgcrypto-encrypted). */
  credentialsEncrypted: Buffer | null;
  initialStatus: McpConnectionStatus; // 'pending' for oauth, 'active' for bearer
}

export async function installFromCatalog(
  input: InstallFromCatalogInput,
): Promise<McpConnection> {
  const [row] = await db
    .insert(mcpConnections)
    .values({
      companyId: input.companyId,
      name: input.name,
      serverUrl: input.serverUrl,
      authType: input.authType,
      credentialsEncrypted: input.credentialsEncrypted,
      status: input.initialStatus,
      catalogId: input.catalogId,
    })
    .returning();
  return toConnection(row);
}

export async function updateConnectionCredentials(
  id: string,
  companyId: string,
  credentialsEncrypted: Buffer,
  status: McpConnectionStatus = 'active',
): Promise<McpConnection | null> {
  const [row] = await db
    .update(mcpConnections)
    .set({ credentialsEncrypted, status, lastErrorMessage: null })
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.companyId, companyId)))
    .returning();
  return row ? toConnection(row) : null;
}
```

- [ ] **Step 2: Extend the POST body schema + branch on catalog install**

In `src/app/api/admin/connectors/route.ts`, replace the `createSchema`/POST body with:

```ts
const catalogInstallSchema = z.object({
  catalogId: z.string().min(1),
  // For `authMode=bearer` catalog entries only.
  bearerToken: z.string().trim().min(1).max(4096).optional(),
});

const customInstallSchema = z.object({
  name: z.string().trim().min(1).max(100),
  serverUrl: z.string().trim().min(1).max(2048).refine(
    (v) => {
      try {
        const url = new URL(v);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'serverUrl must be an http(s) URL.' },
  ),
  authType: z.enum(['none', 'bearer']),
  bearerToken: z.string().trim().min(1).max(4096).optional(),
});

// z.union is NOT suitable here — `customInstallSchema` doesn't forbid
// `catalogId`, so a body with BOTH catalogId and name/serverUrl would
// silently match the custom arm. Branch on `'catalogId' in body` BEFORE
// parsing:

function isCatalogInstall(body: unknown): body is { catalogId: unknown } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'catalogId' in (body as object) &&
    (body as { catalogId: unknown }).catalogId !== undefined
  );
}
```

Inside `POST`, after auth, branch on whether `body.catalogId` is set:

- Catalog install (body matches `isCatalogInstall`): parse with `catalogInstallSchema`, look up `getCatalogEntry(catalogId)`. If not found, 400. If `authMode === 'oauth-dcr'`, run OAuth kickoff (next step). If `authMode === 'bearer'`, require `bearerToken`, encrypt as a `CredentialsBearer` JSON, call `installFromCatalog` with `initialStatus='active'`, then run the connect test (existing `testConnection`).
- Custom (no `catalogId`): parse with `customInstallSchema` and reuse the existing `createConnection` + `testConnection` path.

OAuth kickoff:

```ts
import { CONNECTOR_CATALOG, getCatalogEntry } from '@/lib/connectors/catalog';
import { resolveAuthServerMetadata, performDcr, buildAuthorizeUrl } from '@/lib/connectors/mcp-oauth';
import { generatePkce, signState } from '@/lib/connectors/pkce';
import { savePkceVerifier } from '@/lib/connectors/pkce-store';
import { installFromCatalog } from '@/lib/mcp-out/connections';
import { encryptCredential } from '@/lib/mcp-out/connections';
import { encodeCredentials } from '@/lib/connectors/credentials';

async function kickoffOauthInstall(
  companyId: string,
  entry: ConnectorCatalogEntry,
  origin: string,
): Promise<
  | { ok: true; connection: McpConnection; authorizeUrl: string }
  | { ok: false; error: string; detail?: string }
> {
  const mcpUrl = new URL(entry.mcpUrl);
  const meta = await resolveAuthServerMetadata(mcpUrl);
  if (!meta.ok) return { ok: false, error: meta.error, detail: meta.detail };

  const redirectUri = `${origin}/api/admin/connectors/oauth/callback`;
  const dcr = await performDcr(meta.metadata, { redirectUri, clientName: 'Locus' });
  if (!dcr.ok) return { ok: false, error: 'dcr_failed', detail: dcr.error };

  // Encrypt a placeholder credentials blob holding the DCR client creds
  // + metadata — needed at callback time. access/refresh tokens are
  // empty strings until the callback lands.
  const placeholder = encodeCredentials({
    kind: 'oauth',
    accessToken: '',
    refreshToken: '',
    expiresAt: new Date(0).toISOString(),
    tokenType: 'Bearer',
    scope: null,
    dcrClientId: dcr.clientId,
    dcrClientSecret: dcr.clientSecret,
    authServerMetadata: meta.metadata,
  });
  const credentialsEncrypted = await encryptCredential(placeholder);

  const connection = await installFromCatalog({
    companyId,
    catalogId: entry.id,
    name: entry.name,
    serverUrl: entry.mcpUrl,
    authType: 'oauth',
    credentialsEncrypted,
    initialStatus: 'pending',
  });

  const secret = process.env.CONNECTORS_STATE_SECRET;
  if (!secret) throw new Error('CONNECTORS_STATE_SECRET not set');

  const { verifier, challenge } = generatePkce();
  const state = signState(
    { connectionId: connection.id, csrf: Math.random().toString(36).slice(2) },
    secret,
    600,
  );
  savePkceVerifier(state, verifier);

  const authorizeUrl = buildAuthorizeUrl(meta.metadata, {
    clientId: dcr.clientId,
    redirectUri,
    scope: meta.metadata.scopesSupported?.join(' ') ?? null,
    state,
    codeChallenge: challenge,
  });

  return { ok: true, connection, authorizeUrl };
}
```

The route reads `origin` from `new URL(request.url).origin`.

- [ ] **Step 3: Add the route test — catalog OAuth kickoff**

Extend `src/app/api/admin/connectors/__tests__/route.test.ts`. Mock `@/lib/connectors/mcp-oauth`'s `resolveAuthServerMetadata`, `performDcr`, and `buildAuthorizeUrl`. Assert: given `{ catalogId: 'linear' }`, POST returns `{ connection: { status: 'pending', authType: 'oauth', catalogId: 'linear' }, next: { kind: 'oauth', authorizeUrl: <string> } }`, and the row is written with those fields.

(Concrete test code follows the existing file's pattern — hoisted `vi.mock` for the oauth module, scratch company, owner auth stub.)

- [ ] **Step 4: Run tests**

```bash
cd locus-web && npx vitest run src/app/api/admin/connectors
```
Expected: existing + new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/connectors src/lib/mcp-out/connections.ts
git commit -m "feat(connectors): catalog install + OAuth kickoff on POST"
```

---

## Task 10: `GET /api/admin/connectors/oauth/callback`

**Files:**
- Create: `src/app/api/admin/connectors/oauth/callback/route.ts`
- Modify: `src/app/api/admin/connectors/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing route test**

Add a describe block that POSTs a catalog install (with all oauth primitives mocked to deterministic values), captures the generated `state`, and then GETs the callback with a fake `code=abc` + `state=<captured>`. Mock `exchangeCodeForTokens` to return a fresh token set. Assert:
- The connection row's `status` flipped to `'active'`.
- The row's decrypted credentials blob contains the new access/refresh tokens.
- The HTTP response body is `text/html` and contains `window.opener.postMessage`.

- [ ] **Step 2: Implement the callback**

```ts
// GET /api/admin/connectors/oauth/callback
// Completes the OAuth flow that a catalog install kicked off. Renders an
// HTML page that posts a message to window.opener and closes — the
// parent tab listens and refreshes the list.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { mcpConnections } from '@/db/schema';
import { takePkceVerifier } from '@/lib/connectors/pkce-store';
import { verifyState } from '@/lib/connectors/pkce';
import { exchangeCodeForTokens } from '@/lib/connectors/mcp-oauth';
import { encodeCredentials, decodeCredentials } from '@/lib/connectors/credentials';
import {
  decryptCredential,
  encryptCredential,
  updateConnectionCredentials,
  markConnectionError,
} from '@/lib/mcp-out/connections';
import { logEvent } from '@/lib/audit/logger';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return renderResult({ ok: false, message: `Provider returned: ${error}` });
  if (!code || !state) return renderResult({ ok: false, message: 'Missing code or state.' });

  const secret = process.env.CONNECTORS_STATE_SECRET;
  if (!secret) return renderResult({ ok: false, message: 'Server misconfigured.' });

  const verified = verifyState(state, secret);
  if (!verified.ok) return renderResult({ ok: false, message: `State invalid: ${verified.reason}` });

  const verifier = takePkceVerifier(state);
  if (!verifier) return renderResult({ ok: false, message: 'Verifier missing or expired.' });

  const connectionId = verified.payload.connectionId;
  // Load the connection from any company — the state MAC proves the
  // caller completed the owner-gated install flow, so we don't require
  // an auth session on this callback (browsers won't send Locus cookies
  // when redirected from a third-party OAuth page anyway).
  const conn = await findConnectionById(connectionId);
  if (!conn) return renderResult({ ok: false, message: 'Connection not found.' });

  const placeholder = decodeCredentials(await decryptCredential(conn.credentialsEncrypted!));
  if (placeholder.kind !== 'oauth') return renderResult({ ok: false, message: 'Unexpected credentials kind.' });

  const exchange = await exchangeCodeForTokens(placeholder.authServerMetadata, {
    clientId: placeholder.dcrClientId,
    clientSecret: placeholder.dcrClientSecret,
    code,
    codeVerifier: verifier,
    redirectUri: `${url.origin}/api/admin/connectors/oauth/callback`,
  });
  if (!exchange.ok) {
    await markConnectionError(connectionId, `OAuth exchange failed: ${exchange.error}`);
    return renderResult({ ok: false, message: exchange.error });
  }

  const final = encodeCredentials({
    kind: 'oauth',
    ...exchange.tokens,
    dcrClientId: placeholder.dcrClientId,
    dcrClientSecret: placeholder.dcrClientSecret,
    authServerMetadata: placeholder.authServerMetadata,
  });
  const encrypted = await encryptCredential(final);
  await updateConnectionCredentials(connectionId, conn.companyId, encrypted, 'active');

  logEvent({
    companyId: conn.companyId,
    category: 'administration',
    eventType: 'mcp.connection.created',
    actorType: 'system',
    targetType: 'connection',
    targetId: connectionId,
    details: { via: 'oauth', catalogId: conn.catalogId },
  });

  return renderResult({ ok: true, connectionId });
}

async function findConnectionById(id: string) {
  // Cross-tenant lookup — the MAC-verified state guarantees we only
  // ever land here via a flow that the original owner started, so we
  // don't scope by companyId (no session cookies arrive on the OAuth
  // redirect from the provider).
  const [row] = await db
    .select()
    .from(mcpConnections)
    .where(eq(mcpConnections.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    catalogId: row.catalogId,
    credentialsEncrypted: row.credentialsEncrypted,
  };
}

function renderResult(r: { ok: true; connectionId: string } | { ok: false; message: string }): Response {
  const payload = JSON.stringify(r);
  const html = `<!doctype html><meta charset="utf-8"><title>Connecting…</title>
<body style="font:14px system-ui;padding:24px;color:#222">
${r.ok ? 'Connected. This window will close.' : 'Connection failed. You can close this window.'}
<script>
(function () {
  try {
    if (window.opener) {
      window.opener.postMessage({ kind: 'connector-oauth-complete', result: ${payload} }, window.location.origin);
    }
  } catch (e) {}
  setTimeout(function () { window.close(); }, 500);
})();
</script>
</body>`;
  return new Response(html, {
    status: r.ok ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
```

- [ ] **Step 3: Run tests**

```bash
cd locus-web && npx vitest run src/app/api/admin/connectors
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/connectors/oauth
git commit -m "feat(connectors): OAuth callback route"
```

---

## Task 11: Reconnect + Disconnect endpoints

**Files:**
- Create: `src/app/api/admin/connectors/[id]/oauth/start/route.ts`
- Create: `src/app/api/admin/connectors/[id]/disconnect/route.ts`
- Modify: `src/app/api/admin/connectors/__tests__/route.test.ts`

- [ ] **Step 1: Implement `POST /:id/oauth/start`**

Extract the authorize-URL build from Task 9 into a helper `async function buildOauthHandshake(connection, metadata, dcrClientId, dcrClientSecret, origin)` that returns `{ authorizeUrl }` and has no insert/update side-effects — it only generates state, saves the PKCE verifier, and builds the URL.

For a fresh catalog install (Task 9), call `resolveAuthServerMetadata` + `performDcr` first, then `buildOauthHandshake`, then `installFromCatalog`.

For reconnect, **reuse the existing DCR client credentials** stored in the row's encrypted blob (decoded via `decodeCredentials`). Do NOT re-register — re-registering would burn a fresh DCR client slot on the provider every reconnect. Steps:

1. `requireOwner`, load the row via `getConnection(id, companyId)`.
2. `decodeCredentials(await decryptCredential(row.credentialsEncrypted!))`. If the decoded blob isn't `kind: 'oauth'`, return 400 "Not an OAuth connection".
3. Update the row to `status='pending'` (leave the credentials blob alone — its DCR client fields are what we need).
4. Call `buildOauthHandshake(row, creds.authServerMetadata, creds.dcrClientId, creds.dcrClientSecret, origin)`.
5. Return `{ authorizeUrl }`.

The callback route (Task 10) already replaces the credentials blob with the fresh tokens on success — the placeholder tokens currently in the row get overwritten.

Response: `{ authorizeUrl }`.

- [ ] **Step 2: Implement `POST /:id/disconnect`**

```ts
import { decryptCredential, getConnection, deleteConnection } from '@/lib/mcp-out/connections';
import { decodeCredentials } from '@/lib/connectors/credentials';
import { requireAuth, requireRole } from '@/lib/api/auth';
// ... existing boilerplate pattern from the [id]/route.ts file

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireOwner();
  if (isResponse(ctx)) return ctx;
  const { id } = await params;

  const conn = await getConnection(id, ctx.companyId);
  if (!conn) return Response.json({ error: 'not_found' }, { status: 404 });

  // Best-effort provider token revocation.
  if (conn.authType === 'oauth' && conn.credentialsEncrypted) {
    try {
      const creds = decodeCredentials(await decryptCredential(conn.credentialsEncrypted));
      if (creds.kind === 'oauth' && creds.authServerMetadata.revocationEndpoint && creds.refreshToken) {
        await fetch(creds.authServerMetadata.revocationEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: creds.refreshToken,
            token_type_hint: 'refresh_token',
            client_id: creds.dcrClientId,
          }).toString(),
        }).catch(() => {});
      }
    } catch {
      // Ignore; we'll delete the row regardless.
    }
  }

  await deleteConnection(id, ctx.companyId);
  logEvent({
    companyId: ctx.companyId,
    category: 'administration',
    eventType: 'mcp.connection.deleted',
    actorType: 'human',
    actorId: ctx.userId,
    targetType: 'connection',
    targetId: id,
    details: { via: 'disconnect', authType: conn.authType },
  });
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Add tests for both**

Reconnect: POST install with mocked OAuth, capture connection id, then POST `/:id/oauth/start` and assert the body has `authorizeUrl`.

Disconnect: seed a row, mock `fetch` (used by the revoke call), POST `/:id/disconnect`, assert the row is gone and `fetch` was called with the revocation endpoint.

- [ ] **Step 4: Run tests + commit**

```bash
cd locus-web && npx vitest run src/app/api/admin/connectors
git add src/app/api/admin/connectors
git commit -m "feat(connectors): reconnect + disconnect endpoints"
```

---

## Task 12: Wire refresh-on-use into the mcp-out client

**Files:**
- Modify: `src/lib/mcp-out/client.ts`
- Modify: `src/lib/mcp-out/__tests__/client.test.ts`
- Modify: `src/lib/mcp-out/connections.ts` (expose `updateConnectionCredentials` — already done in Task 9)

- [ ] **Step 1: Write the failing test**

In `client.test.ts`, add a test: given an `oauth` connection whose `expiresAt` is 30 seconds away, `connectToMcpServer` should call `refreshIfNeeded`, persist refreshed credentials, and use the new access token in the Bearer header. Add a second test for the `invalid_grant` branch asserting `markConnectionError` is called.

Use `vi.mock('@/lib/connectors/mcp-oauth', …)` and `vi.mock('@/lib/mcp-out/connections', …)` to stub the integrations; the subject is the `connectToMcpServer` code path, not the full refresh.

- [ ] **Step 2: Update `connectToMcpServer`**

Replace the auth-type branch:

```ts
import { decodeCredentials, encodeCredentials } from '@/lib/connectors/credentials';
import { refreshIfNeeded } from '@/lib/connectors/mcp-oauth';
import { updateConnectionCredentials, encryptCredential, markConnectionError } from './connections';

// ... inside connectToMcpServer, after decrypting:

let bearerToken: string | null = null;

if (conn.authType === 'bearer' && conn.credentialsEncrypted) {
  // Backward-compat: the old bearer path stored a plain string, not a
  // JSON envelope. Try JSON first; fall back to raw string.
  const decrypted = await decryptCredential(conn.credentialsEncrypted);
  try {
    const envelope = decodeCredentials(decrypted);
    if (envelope.kind === 'bearer') bearerToken = envelope.token;
  } catch {
    bearerToken = decrypted; // pre-envelope rows
  }
} else if (conn.authType === 'oauth' && conn.credentialsEncrypted) {
  const envelope = decodeCredentials(await decryptCredential(conn.credentialsEncrypted));
  if (envelope.kind !== 'oauth') {
    throw new Error(`expected oauth credentials, got ${envelope.kind}`);
  }
  const refresh = await refreshIfNeeded(envelope, new Date());
  if (refresh.kind === 'refreshed') {
    const next = encodeCredentials(refresh.credentials);
    await updateConnectionCredentials(conn.id, conn.companyId, await encryptCredential(next));
    bearerToken = refresh.credentials.accessToken;
  } else if (refresh.kind === 'invalid_grant') {
    await markConnectionError(conn.id, 'Reconnect needed: refresh token rejected.');
    throw new Error('OAuth refresh failed — reconnect needed.');
  } else {
    bearerToken = envelope.accessToken;
  }
}

if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
```

- [ ] **Step 3: Update the bearer write path in `connections.ts`**

`createConnection` / `updateConnection` currently call `encryptCredential(input.bearerToken)` with a raw string. Wrap it in the JSON envelope so the new decode path is always valid:

```ts
import { encodeCredentials } from '@/lib/connectors/credentials';

// In createConnection:
const credentialsEncrypted =
  input.authType === 'bearer' && input.bearerToken && input.bearerToken.length > 0
    ? await encryptCredential(encodeCredentials({ kind: 'bearer', token: input.bearerToken }))
    : null;
```

Do the same in `updateConnection`. Keep the old-decrypt fallback in `client.ts` (Step 2) so existing rows written before this migration still work; the first write-through normalises them.

- [ ] **Step 4: Run tests**

```bash
cd locus-web && npx vitest run src/lib/mcp-out
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp-out
git commit -m "feat(connectors): refresh-on-use for oauth connections in mcp-out client"
```

---

## Task 13: Sidebar swap

**Files:**
- Modify: `src/components/shell/sidebar/sidebar-expanded.tsx`
- Modify: `src/components/shell/sidebar/sidebar-rail.tsx`

- [ ] **Step 1: Update `sidebar-expanded.tsx`**

In `nav-bottom`, replace:

```tsx
<Link href="/mcp" className="quick-item">
  <McpIcon />
  MCP Connections
</Link>
```

with:

```tsx
<Link href="/connectors" className="quick-item">
  <Plug size={15} />
  Connectors
</Link>
```

Import `Plug` from `lucide-react` at the top of the file. Delete the `McpIcon` inline SVG definition (now unused).

- [ ] **Step 2: Update `sidebar-rail.tsx`**

Replace:

```tsx
<Link href="/mcp" className="rail-btn" title="MCP" aria-label="MCP Connections"><Cable size={18} /></Link>
```

with:

```tsx
<Link href="/connectors" className="rail-btn" title="Connectors" aria-label="Connectors"><Plug size={18} /></Link>
```

Swap the `Cable` import for `Plug` in the `lucide-react` import line.

- [ ] **Step 3: Manual check**

```bash
cd locus-web && npm run dev
```
Visit `http://localhost:3000/`. Confirm: sidebar shows "Connectors" with a plug icon. Clicking it goes to `/connectors` (which will 404 until Task 14 — that's expected).

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/sidebar
git commit -m "feat(connectors): sidebar shows Connectors linking to /connectors"
```

---

## Task 14: `/connectors` page + basic list component

**Files:**
- Create: `src/app/(app)/connectors/page.tsx`
- Create: `src/components/connectors/connector-types.ts`
- Create: `src/components/connectors/connector-list.tsx`

This task intentionally ships a minimal list — rows with name/URL/status/disconnect — so the page stops 404'ing. The richer tile/details UI comes in Tasks 15–17.

- [ ] **Step 1: Create `connector-types.ts`**

```ts
export interface ClientConnector {
  id: string;
  catalogId: string | null;
  name: string;
  serverUrl: string;
  authType: 'none' | 'bearer' | 'oauth';
  status: 'active' | 'disabled' | 'error' | 'pending';
  hasCredential: boolean;
  lastErrorMessage: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}
```

- [ ] **Step 2: Create the page**

Follow the same auth pattern as the template being replaced (`src/app/(app)/settings/mcp-connections/page.tsx` — read it first). That page calls `await requireAuth()` without a try/catch because unauthenticated requests are short-circuited upstream by the `(app)` layout. If you see any divergence (e.g. a newer middleware pattern), follow the newer pattern — don't invent a new one here.

```tsx
import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/api/auth';
import { listConnections } from '@/lib/mcp-out/connections';
import { ConnectorList } from '@/components/connectors/connector-list';

export default async function ConnectorsPage() {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();
  if (ctx.role !== 'owner') return notFound();

  const rows = await listConnections(ctx.companyId);
  rows.sort((a, b) => +b.createdAt - +a.createdAt);

  const serialised = rows.map((c) => ({
    id: c.id,
    catalogId: c.catalogId,
    name: c.name,
    serverUrl: c.serverUrl,
    authType: c.authType,
    status: c.status,
    hasCredential: c.credentialsEncrypted !== null,
    lastErrorMessage: c.lastErrorMessage,
    createdAt: c.createdAt.toISOString(),
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          External tools your Platform Agent can call during a chat.
        </p>
      </header>
      <ConnectorList connectors={serialised} autoOpenAddModal={serialised.length === 0} />
    </div>
  );
}
```

- [ ] **Step 3: Create a minimal `ConnectorList`**

A copy of the existing `mcp-connection-list.tsx` pattern, but:
- Rows show the catalog icon (fetched from `CONNECTOR_CATALOG`) next to the name, or a generic icon for custom.
- Replace the existing Delete button with a Disconnect button (POST to `/api/admin/connectors/:id/disconnect`).
- Accept `autoOpenAddModal?: boolean` prop; when true AND `sessionStorage.getItem('connectors.addModalDismissed')` is null, open the Add modal on mount and set the flag. (The `AddConnectorDialog` component arrives in Task 16 — for now, gate this behind a feature check and use a placeholder `<AddConnectorDialog />` import that can be filled in then.)

Until Task 16 lands, `ConnectorList` can render a simple `<Button onClick={openAdd}>+ Add connector</Button>` that fires an `alert('Not yet implemented')`. The page compiles and the navigation works; the rich dialog lands in Task 16.

- [ ] **Step 4: Manual check**

Visit `http://localhost:3000/connectors`. Owner account: see the page header and existing rows. Non-owner: 404.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/connectors src/components/connectors
git commit -m "feat(connectors): /connectors page + minimal list"
```

---

## Task 15: Tile component

**Files:**
- Create: `src/components/connectors/connector-tile.tsx`

```tsx
'use client';

import Image from 'next/image';
import { Plug } from 'lucide-react';
import type { ConnectorCatalogEntry } from '@/lib/connectors/catalog';

interface Props {
  entry: ConnectorCatalogEntry | 'custom';
  onClick: () => void;
}

export function ConnectorTile({ entry, onClick }: Props) {
  const isCustom = entry === 'custom';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-accent"
    >
      <div className="flex size-10 items-center justify-center rounded-md bg-muted">
        {isCustom ? (
          <Plug size={20} />
        ) : (
          <Image src={entry.iconUrl} alt="" width={24} height={24} />
        )}
      </div>
      <div className="font-medium">{isCustom ? 'Custom connector' : entry.name}</div>
      <div className="text-xs text-muted-foreground">
        {isCustom ? 'Point at any MCP endpoint.' : entry.description}
      </div>
    </button>
  );
}
```

- [ ] **Commit**

```bash
git add src/components/connectors/connector-tile.tsx
git commit -m "feat(connectors): catalog tile component"
```

---

## Task 16: AddConnectorDialog (two-state) + OAuth popup

**Files:**
- Create: `src/components/connectors/add-connector-dialog.tsx`
- Create: `src/components/connectors/custom-connector-dialog.tsx` (moved from `settings/`)
- Delete: `src/components/settings/mcp-connection-dialog.tsx`
- Modify: `src/components/connectors/connector-list.tsx` (wire the real dialog)

- [ ] **Step 1: Move + rename the existing dialog**

```bash
cd locus-web && git mv src/components/settings/mcp-connection-dialog.tsx \
                     src/components/connectors/custom-connector-dialog.tsx
```

Inside the moved file, rename the exported component `McpConnectionDialog` → `CustomConnectorDialog`. Keep all `mode="create" | "edit"` behaviour. Update all API URLs to `/api/admin/connectors` (already done in Task 8 but double-check).

- [ ] **Step 2: Implement `AddConnectorDialog`**

Two local states: `'browse'` (grid) and `'details:<catalogId|custom>'`.

- Browse: grid of `ConnectorTile` for each `CONNECTOR_CATALOG` entry + one Custom tile.
- Details for a catalog entry:
  - If `authMode === 'oauth-dcr'`: a "Connect" button that opens a popup at the authorizeUrl returned by `POST /api/admin/connectors` with `{ catalogId }`. A `message` event listener on `window` accepts `{ kind: 'connector-oauth-complete', result }` from the same origin, closes the modal, and `router.refresh()`.
  - If `authMode === 'bearer'`: inline `<Input type="password">` for API key; Submit calls the same POST with `{ catalogId, bearerToken }` (no popup), closes on success.
- Details for Custom: render `<CustomConnectorDialog mode="create" />` inline (pull out its form JSX into a reusable `<CustomConnectorForm />` component if the existing surface doesn't cleanly compose; keep it local if it does).

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ArrowLeft } from 'lucide-react';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CONNECTOR_CATALOG, type ConnectorCatalogEntry } from '@/lib/connectors/catalog';
import { ConnectorTile } from './connector-tile';
import { CustomConnectorDialog } from './custom-connector-dialog';

type View = { kind: 'browse' } | { kind: 'details'; entry: ConnectorCatalogEntry | 'custom' };

interface Props {
  initiallyOpen?: boolean;
}

export function AddConnectorDialog({ initiallyOpen = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [view, setView] = useState<View>({ kind: 'browse' });

  useEffect(() => {
    if (!open) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { kind?: string; result?: { ok: boolean } };
      if (data?.kind === 'connector-oauth-complete') {
        setOpen(false);
        router.refresh();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, router]);

  async function startOauth(entry: ConnectorCatalogEntry) {
    const res = await fetch('/api/admin/connectors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalogId: entry.id }),
    });
    if (!res.ok) { alert('Failed to start connection.'); return; }
    const { next } = (await res.json()) as { next: { kind: 'oauth'; authorizeUrl: string } | { kind: 'done' } };
    if (next.kind === 'oauth') {
      window.open(next.authorizeUrl, 'connector-oauth', 'popup,width=560,height=720');
    } else {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" />Add connector</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        {view.kind === 'browse' ? (
          <>
            <DialogHeader><DialogTitle>Add a connector</DialogTitle></DialogHeader>
            <div className="grid grid-cols-3 gap-3 pt-2">
              {CONNECTOR_CATALOG.map((entry) => (
                <ConnectorTile key={entry.id} entry={entry} onClick={() => setView({ kind: 'details', entry })} />
              ))}
              <ConnectorTile entry="custom" onClick={() => setView({ kind: 'details', entry: 'custom' })} />
            </div>
          </>
        ) : view.entry === 'custom' ? (
          <CustomDetails onBack={() => setView({ kind: 'browse' })} />
        ) : (
          <CatalogDetails entry={view.entry} onBack={() => setView({ kind: 'browse' })} onConnect={() => startOauth(view.entry as ConnectorCatalogEntry)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// … CatalogDetails renders entry.name, entry.description, docsUrl, auth-mode label,
// and a Connect button that delegates to the parent's onConnect (OAuth) or,
// for bearer-mode, an inline token input that POSTs { catalogId, bearerToken }.

// … CustomDetails composes the existing CustomConnectorDialog's form into
// the current modal (no nested modals).
```

Move the form body of `CustomConnectorDialog` out into a `<CustomConnectorForm onDone={...} />` helper so `CustomDetails` can render it inline without spawning a second Radix dialog.

- [ ] **Step 3: Wire into `ConnectorList`**

Replace the placeholder button with `<AddConnectorDialog initiallyOpen={sessionStickyOpen} />`, where `sessionStickyOpen` is computed in a `useEffect` on mount from `autoOpenAddModal && !sessionStorage.getItem('connectors.addModalDismissed')`, then `sessionStorage.setItem('connectors.addModalDismissed', '1')` on any close.

- [ ] **Step 4: Manual check**

```bash
cd locus-web && npm run dev
```
Visit `/connectors`, click Add, browse grid appears, click Linear → details → Connect opens a popup. (The popup will hit a real provider — either complete the flow against Linear or kill the popup; the point here is the UX.)

- [ ] **Step 5: Commit**

```bash
git rm src/components/settings/mcp-connection-dialog.tsx
git add src/components/connectors src/components/shell/sidebar
git commit -m "feat(connectors): two-state Add dialog with OAuth popup + bearer fallback"
```

---

## Task 17: Details dialog + full list rewrite

**Files:**
- Create: `src/components/connectors/connector-details-dialog.tsx`
- Modify: `src/components/connectors/connector-list.tsx`
- Delete: `src/components/settings/mcp-connection-list.tsx`
- Delete: `src/components/settings/mcp-connection-types.ts`

- [ ] **Step 1: ConnectorDetailsDialog**

Opens when a row is clicked. Shows icon + name + status + lastError + lastUsedAt + created + toolCount (from the last probe — TODO: add to row; acceptable to omit in v1). Renders a Disconnect button (destructive) and, for `authType='oauth'` or `status='error'`, a Reconnect button that POSTs `/:id/oauth/start` and opens a popup.

- [ ] **Step 2: ConnectorList rewrite**

Restructure as rows with icon + name + status pill + action buttons. Click a row → opens `ConnectorDetailsDialog`. Keep the existing `disconnect` call semantics (the details dialog wraps it now).

- [ ] **Step 3: Delete old settings components**

```bash
cd locus-web && git rm src/components/settings/mcp-connection-list.tsx src/components/settings/mcp-connection-types.ts
```

Fix any remaining imports.

- [ ] **Step 4: Typecheck + manual**

```bash
cd locus-web && npx tsc --noEmit
cd locus-web && npm run dev
```

Visit `/connectors`, click a row, disconnect works, reconnect opens a popup.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/connectors src/components/settings
git commit -m "feat(connectors): details dialog + list rewrite"
```

---

## Task 18: Delete legacy settings page + final cleanup

**Files:**
- Delete: `src/app/(app)/settings/mcp-connections/page.tsx`

- [ ] **Step 1: Delete the old page**

```bash
cd locus-web && git rm src/app/\(app\)/settings/mcp-connections/page.tsx
```

- [ ] **Step 2: Find stale references**

```bash
cd locus-web && grep -rn "settings/mcp-connections\|MCP Connections\|McpConnectionDialog\|McpConnectionList" src/
```
Expected: no matches (or only comments that can be updated). Fix any matches.

- [ ] **Step 3: Typecheck + build**

```bash
cd locus-web && npx tsc --noEmit
cd locus-web && npm run build
```
Expected: clean build.

- [ ] **Step 4: Run full test suite**

```bash
cd locus-web && npx vitest run
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(connectors): drop legacy /settings/mcp-connections page"
```

---

## Task 19: Manual QA pass

Pre-ship. No new code unless bugs are found.

- [ ] Empty-state auto-opens the Add modal. Close it, refresh — modal does not reopen. New tab — modal reopens.
- [ ] Click Linear tile → details → Connect → popup opens → consent → popup closes → row appears with `status='active'` and the Linear icon.
- [ ] Kill the popup mid-flow — row remains in `status='pending'`. Click row → Reconnect → flow completes.
- [ ] Disconnect from the details dialog — row gone, audit event emitted.
- [ ] Send a chat turn that would invoke a Linear tool — the tool is callable, arguments pass through. (Confirm via console logs or axiom.)
- [ ] Custom connector tile → form still works against a BYO MCP URL.
- [ ] Force-expire a token (edit DB to set `expiresAt` in the past) and trigger a tool call — refresh fires, new token is stored, call succeeds.
- [ ] Invalidate a refresh token (revoke on provider) and trigger a tool call — row flips to `status='error'` with "Reconnect needed".
- [ ] Non-owner account visits `/connectors` — 404.

---

## Post-implementation follow-ups (not in this plan)

- Swap `pkce-store` for a KV-backed implementation when deploying to multiple instances.
- Pending-row sweeper cron for abandoned OAuth flows.
- Replace placeholder icons with real brand SVGs.
- Revisit `/settings/agent-access` (Connected apps + Access tokens) as a separate workstream.
- Consider pre-registered OAuth clients for providers that don't implement DCR.

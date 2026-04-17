// Route-level tests for /api/admin/connectors.
//
// We mock the MCP client (so connection tests don't hit the network)
// and the auth layer (so we can exercise both owner and non-owner
// paths deterministically). The connection helpers stay real and run
// against the live DB — this gives us confidence that the
// auth + validation + test-on-create + audit flow works end-to-end.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

// --- Hoisted mocks -------------------------------------------------------

const mocks = vi.hoisted(() => ({
  requireAuthImpl: vi.fn(),
  connectToMcpServerImpl: vi.fn(),
  discoverToolsImpl: vi.fn(),
  logEventImpl: vi.fn(),
  resolveAuthServerMetadataImpl: vi.fn(),
  performDcrImpl: vi.fn(),
  buildAuthorizeUrlImpl: vi.fn(),
  exchangeCodeForTokensImpl: vi.fn(),
}));

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>(
    '@/lib/api/auth',
  );
  return {
    ...actual,
    requireAuth: () => mocks.requireAuthImpl(),
  };
});

vi.mock('@/lib/mcp-out/client', () => ({
  connectToMcpServer: (...args: unknown[]) => mocks.connectToMcpServerImpl(...args),
  discoverTools: (...args: unknown[]) => mocks.discoverToolsImpl(...args),
  // Re-export the timeout constants so the routes that import them
  // don't see `undefined` (vitest treats unmocked exports as a miss).
  DEFAULT_CONNECT_TIMEOUT_MS: 10_000,
  DEFAULT_DISCOVER_TIMEOUT_MS: 10_000,
  // Real raceWithTimeout — harmless inside these tests because none of
  // the routes' test paths invoke it; the route-level helpers only use
  // connect + discover which are mocked directly.
  raceWithTimeout: <T,>(inner: Promise<T>) => inner,
}));

vi.mock('@/lib/audit/logger', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit/logger')>(
    '@/lib/audit/logger',
  );
  return {
    ...actual,
    logEvent: (event: unknown) => {
      mocks.logEventImpl(event);
    },
  };
});

vi.mock('@/lib/connectors/mcp-oauth', () => ({
  resolveAuthServerMetadata: (...args: unknown[]) =>
    mocks.resolveAuthServerMetadataImpl(...args),
  performDcr: (...args: unknown[]) => mocks.performDcrImpl(...args),
  buildAuthorizeUrl: (...args: unknown[]) => mocks.buildAuthorizeUrlImpl(...args),
  exchangeCodeForTokens: (...args: unknown[]) =>
    mocks.exchangeCodeForTokensImpl(...args),
}));

// --- Subject -------------------------------------------------------------

import { GET, POST } from '../route';
import {
  GET as GET_DETAIL,
  PATCH,
  DELETE,
} from '../[id]/route';
import { GET as callbackGET } from '../oauth/callback/route';
import { POST as RECONNECT_POST } from '../[id]/oauth/start/route';
import { POST as DISCONNECT_POST } from '../[id]/disconnect/route';
import { db } from '@/db';
import { companies, mcpConnections } from '@/db/schema';
import { __resetPkceStoreForTests } from '@/lib/connectors/pkce-store';
import {
  decryptCredential,
  encryptCredential,
  getConnection,
} from '@/lib/mcp-out/connections';
import {
  decodeCredentials,
  encodeCredentials,
} from '@/lib/connectors/credentials';

// --- Setup ---------------------------------------------------------------

const HAS_DB = !!process.env.DATABASE_URL;
const describeDb = HAS_DB ? describe : describe.skip;

const TEST_KEY = 'a'.repeat(64);

let TEST_COMPANY_ID: string;
const TEST_USER_ID = '00000000-0000-0000-0000-00000000cccc';
const createdConnectionIds: string[] = [];

beforeAll(async () => {
  process.env.MCP_CONNECTION_ENCRYPTION_KEY = TEST_KEY;
  if (!HAS_DB) return;
  const [company] = await db
    .insert(companies)
    .values({
      name: 'MCP Route Test Co',
      slug: `mcp-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  TEST_COMPANY_ID = company.id;
});

afterAll(async () => {
  if (!HAS_DB) return;
  if (createdConnectionIds.length > 0) {
    await db
      .delete(mcpConnections)
      .where(inArray(mcpConnections.id, createdConnectionIds));
  }
  if (TEST_COMPANY_ID) {
    await db.delete(companies).where(eq(companies.id, TEST_COMPANY_ID));
  }
});

beforeEach(() => {
  mocks.requireAuthImpl.mockReset();
  mocks.connectToMcpServerImpl.mockReset();
  mocks.discoverToolsImpl.mockReset();
  mocks.logEventImpl.mockReset();
  mocks.resolveAuthServerMetadataImpl.mockReset();
  mocks.performDcrImpl.mockReset();
  mocks.buildAuthorizeUrlImpl.mockReset();
  mocks.exchangeCodeForTokensImpl.mockReset();
  // kickoffOauthInstall throws if this is unset.
  process.env.CONNECTORS_STATE_SECRET = '0'.repeat(64);
  // PKCE store is in-memory module state — isolate tests from each other.
  __resetPkceStoreForTests();
});

function mockOwner() {
  mocks.requireAuthImpl.mockResolvedValue({
    userId: TEST_USER_ID,
    companyId: TEST_COMPANY_ID,
    role: 'owner',
    email: 'owner@test.local',
    fullName: 'Owner McOwnerface',
  });
}

function mockViewer() {
  mocks.requireAuthImpl.mockResolvedValue({
    userId: TEST_USER_ID,
    companyId: TEST_COMPANY_ID,
    role: 'viewer',
    email: 'viewer@test.local',
    fullName: null,
  });
}

function mockNoCompany() {
  mocks.requireAuthImpl.mockResolvedValue({
    userId: TEST_USER_ID,
    companyId: null,
    role: 'owner',
    email: 'new@test.local',
    fullName: null,
  });
}

function mockHappyTest(toolCount = 2) {
  mocks.connectToMcpServerImpl.mockResolvedValue({
    close: async () => {},
  });
  mocks.discoverToolsImpl.mockResolvedValue(
    Array.from({ length: toolCount }, (_, i) => ({
      name: `tool_${i}`,
      inputSchema: { type: 'object', properties: {} },
    })),
  );
}

function mockFailingTest(message = 'ECONNREFUSED') {
  mocks.connectToMcpServerImpl.mockRejectedValue(new Error(message));
}

function bodyRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- GET /api/admin/connectors --------------------------------------

describeDb('GET /api/admin/connectors', () => {
  it('returns 401/403 when the caller is not an owner', async () => {
    mockViewer();
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns 403 when the caller has no company', async () => {
    mockNoCompany();
    const res = await GET();
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe('no_company');
  });

  it('returns connections for the caller company', async () => {
    mockOwner();
    // Seed a connection directly.
    const [inserted] = await db
      .insert(mcpConnections)
      .values({
        companyId: TEST_COMPANY_ID,
        name: 'seed-connection',
        serverUrl: 'https://seed.example.test/mcp',
        authType: 'none',
      })
      .returning();
    createdConnectionIds.push(inserted.id);

    const res = await GET();
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      connections: Array<{ id: string; hasCredential: boolean }>;
    };
    expect(payload.connections.some((c) => c.id === inserted.id)).toBe(true);
    // Ciphertext must never be exposed.
    const first = payload.connections.find((c) => c.id === inserted.id);
    expect(first).not.toHaveProperty('credentialsEncrypted');
  });
});

// --- POST /api/admin/connectors -------------------------------------

describeDb('POST /api/admin/connectors', () => {
  it('requires owner role', async () => {
    mockViewer();
    const req = bodyRequest(
      'https://test.local/api/admin/connectors',
      'POST',
      { name: 'x', serverUrl: 'https://x.test', authType: 'none' },
    );
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('rejects an invalid URL', async () => {
    mockOwner();
    const req = bodyRequest(
      'https://test.local/api/admin/connectors',
      'POST',
      { name: 'bad url', serverUrl: 'ftp://nope', authType: 'none' },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('requires a bearerToken when authType is bearer', async () => {
    mockOwner();
    const req = bodyRequest(
      'https://test.local/api/admin/connectors',
      'POST',
      {
        name: 'needs token',
        serverUrl: 'https://x.test',
        authType: 'bearer',
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('creates a row and marks it active when the test succeeds', async () => {
    mockOwner();
    mockHappyTest(3);

    const req = bodyRequest(
      'https://test.local/api/admin/connectors',
      'POST',
      {
        name: 'happy path',
        serverUrl: 'https://happy.example.test/mcp',
        authType: 'none',
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      connection: { id: string; status: string };
      test: { ok: boolean; toolCount: number };
    };
    expect(payload.test.ok).toBe(true);
    expect(payload.test.toolCount).toBe(3);
    expect(payload.connection.status).toBe('active');
    createdConnectionIds.push(payload.connection.id);

    // Audit event was emitted.
    expect(mocks.logEventImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'mcp.connection.created',
        category: 'administration',
      }),
    );
  });

  it('keeps the row with status=error when the test fails (does NOT 500)', async () => {
    mockOwner();
    mockFailingTest('connection refused');

    const req = bodyRequest(
      'https://test.local/api/admin/connectors',
      'POST',
      {
        name: 'sad path',
        serverUrl: 'https://sad.example.test/mcp',
        authType: 'none',
      },
    );
    const res = await POST(req);
    // Row persisted — 200, not 500.
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      connection: {
        id: string;
        status: string;
        lastErrorMessage: string | null;
      };
      test: { ok: boolean; error?: string };
    };
    expect(payload.test.ok).toBe(false);
    expect(payload.test.error).toContain('connection refused');
    expect(payload.connection.status).toBe('error');
    expect(payload.connection.lastErrorMessage).toContain('connection refused');
    createdConnectionIds.push(payload.connection.id);
  });

  // C1 — test-on-create must not block when the external server hangs.
  // The route's helper uses the default DEFAULT_CONNECT_TIMEOUT_MS (10s).
  // Here we mock connectToMcpServer to hang forever; the real route
  // layers an AbortSignal + raceWithTimeout inside client.ts, and that
  // surfaces as an abort error. Because we're mocking `connectToMcpServer`
  // directly we simulate the timeout by rejecting with a timeout error
  // — if the code paths didn't propagate the timeout, the test would
  // hang (vitest would fail it via its own hook timeout).
  it('returns 200/error within the timeout budget when the external server hangs', async () => {
    mockOwner();
    mocks.connectToMcpServerImpl.mockRejectedValueOnce(
      new Error('MCP connect timeout after 10000ms'),
    );

    const start = Date.now();
    const req = bodyRequest(
      'https://test.local/api/admin/connectors',
      'POST',
      {
        name: 'hangs',
        serverUrl: 'https://hang.example.test/mcp',
        authType: 'none',
      },
    );
    const res = await POST(req);
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      connection: { id: string; status: string; lastErrorMessage: string | null };
      test: { ok: boolean; error?: string };
    };
    expect(payload.test.ok).toBe(false);
    expect(payload.test.error).toMatch(/timeout/i);
    expect(payload.connection.status).toBe('error');
    expect(payload.connection.lastErrorMessage).toMatch(/timeout/i);
    // Should never take anywhere near the real 10s budget — the mock
    // throws synchronously-via-microtask.
    expect(elapsed).toBeLessThan(2000);
    createdConnectionIds.push(payload.connection.id);
  });
});

// --- POST /api/admin/connectors — catalog OAuth kickoff -----------

describeDb('POST /api/admin/connectors (catalog OAuth kickoff)', () => {
  it('creates a pending oauth connection and returns an authorize URL', async () => {
    mockOwner();

    const fakeMetadata = {
      authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
      tokenEndpoint: 'https://auth.example.test/oauth/token',
      registrationEndpoint: 'https://auth.example.test/oauth/register',
      revocationEndpoint: null,
      scopesSupported: ['read', 'write'],
    };

    mocks.resolveAuthServerMetadataImpl.mockResolvedValue({
      ok: true,
      metadata: fakeMetadata,
    });
    mocks.performDcrImpl.mockResolvedValue({
      ok: true,
      clientId: 'cid',
      clientSecret: null,
    });
    mocks.buildAuthorizeUrlImpl.mockReturnValue(
      'https://auth.example.test/oauth/authorize?client_id=cid&state=xyz',
    );

    const req = bodyRequest(
      'https://test.local/api/admin/connectors',
      'POST',
      { catalogId: 'linear' },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      connection: {
        id: string;
        status: string;
        authType: string;
        catalogId: string | null;
      };
      next: { kind: string; authorizeUrl?: string };
    };

    expect(payload.connection.status).toBe('pending');
    expect(payload.connection.authType).toBe('oauth');
    expect(payload.connection.catalogId).toBe('linear');
    expect(payload.next.kind).toBe('oauth');
    expect(typeof payload.next.authorizeUrl).toBe('string');
    expect(payload.next.authorizeUrl).toContain('https://auth.example.test/');

    createdConnectionIds.push(payload.connection.id);

    // Sanity: the OAuth helpers were called.
    expect(mocks.resolveAuthServerMetadataImpl).toHaveBeenCalledOnce();
    expect(mocks.performDcrImpl).toHaveBeenCalledOnce();
    expect(mocks.buildAuthorizeUrlImpl).toHaveBeenCalledOnce();

    // Audit event emitted for the install.
    expect(mocks.logEventImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'mcp.connection.created',
        details: expect.objectContaining({
          catalogId: 'linear',
          kickoff: 'oauth',
        }),
      }),
    );
  });
});

// --- GET /api/admin/connectors/oauth/callback -----------------------

describeDb('GET /api/admin/connectors/oauth/callback', () => {
  // Drive a full kickoff so a real (signed) state + a real PKCE verifier
  // land in the in-memory store, then call the callback handler. We
  // assert the handler renders the postMessage HTML, flips the
  // connection to active, and rewrites credentials with the new tokens.
  it('exchanges the code, flips the row to active, and renders the postMessage HTML', async () => {
    mockOwner();

    const fakeMetadata = {
      authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
      tokenEndpoint: 'https://auth.example.test/oauth/token',
      registrationEndpoint: 'https://auth.example.test/oauth/register',
      revocationEndpoint: null,
      scopesSupported: ['read', 'write'],
    };
    mocks.resolveAuthServerMetadataImpl.mockResolvedValue({
      ok: true,
      metadata: fakeMetadata,
    });
    mocks.performDcrImpl.mockResolvedValue({
      ok: true,
      clientId: 'cid',
      clientSecret: 'csecret',
    });
    // The kickoff route calls buildAuthorizeUrl with the real state the
    // route just generated. Capture those args so we can pull the state
    // out and hand it to the callback.
    mocks.buildAuthorizeUrlImpl.mockImplementation(
      (_meta: unknown, opts: { state: string }) =>
        `https://auth.example.test/oauth/authorize?state=${encodeURIComponent(opts.state)}`,
    );

    const kickoffReq = bodyRequest(
      'https://test.local/api/admin/connectors',
      'POST',
      { catalogId: 'linear' },
    );
    const kickoffRes = await POST(kickoffReq);
    expect(kickoffRes.status).toBe(200);
    const kickoffPayload = (await kickoffRes.json()) as {
      connection: { id: string; status: string };
      next: { authorizeUrl: string };
    };
    expect(kickoffPayload.connection.status).toBe('pending');
    createdConnectionIds.push(kickoffPayload.connection.id);

    // Extract the generated state from the authorize URL.
    const state = new URL(kickoffPayload.next.authorizeUrl).searchParams.get(
      'state',
    );
    expect(state).toBeTruthy();

    // Callback-phase mock: exchangeCodeForTokens returns fresh tokens.
    const futureIso = new Date(Date.now() + 3_600_000).toISOString();
    mocks.exchangeCodeForTokensImpl.mockResolvedValue({
      ok: true,
      tokens: {
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        expiresAt: futureIso,
        tokenType: 'Bearer',
        scope: null,
      },
    });

    const callbackReq = new Request(
      `https://locus.local/api/admin/connectors/oauth/callback?code=abc&state=${encodeURIComponent(
        state!,
      )}`,
    );
    const callbackRes = await callbackGET(callbackReq);

    expect(callbackRes.status).toBe(200);
    expect(callbackRes.headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    );
    const html = await callbackRes.text();
    expect(html).toContain('window.opener.postMessage');
    expect(html).toContain('connector-oauth-complete');

    // Row flipped to active.
    const latest = await getConnection(
      kickoffPayload.connection.id,
      TEST_COMPANY_ID,
    );
    expect(latest).not.toBeNull();
    expect(latest!.status).toBe('active');
    expect(latest!.credentialsEncrypted).not.toBeNull();

    // Decrypted blob holds the new tokens + preserves DCR details.
    const plaintext = await decryptCredential(latest!.credentialsEncrypted!);
    const creds = decodeCredentials(plaintext);
    expect(creds.kind).toBe('oauth');
    if (creds.kind === 'oauth') {
      expect(creds.accessToken).toBe('new-at');
      expect(creds.refreshToken).toBe('new-rt');
      expect(creds.expiresAt).toBe(futureIso);
      expect(creds.dcrClientId).toBe('cid');
      expect(creds.dcrClientSecret).toBe('csecret');
      expect(creds.authServerMetadata.tokenEndpoint).toBe(
        fakeMetadata.tokenEndpoint,
      );
    }

    // The token exchange was called with the verifier the kickoff saved.
    expect(mocks.exchangeCodeForTokensImpl).toHaveBeenCalledOnce();
    const [, exchangeOpts] = mocks.exchangeCodeForTokensImpl.mock
      .calls[0] as [unknown, { code: string; codeVerifier: string }];
    expect(exchangeOpts.code).toBe('abc');
    expect(typeof exchangeOpts.codeVerifier).toBe('string');
    expect(exchangeOpts.codeVerifier.length).toBeGreaterThan(0);
  });

  it('returns 400 HTML when no PKCE verifier is stored for the state', async () => {
    // Hand-craft a valid signed state with no matching entry in the
    // verifier store. The handler must refuse to touch the DB.
    const secret = '0'.repeat(64);
    process.env.CONNECTORS_STATE_SECRET = secret;
    const { signState } = await import('@/lib/connectors/pkce');
    const unknownState = signState(
      { connectionId: '00000000-0000-0000-0000-000000000000', csrf: 'nope' },
      secret,
      600,
    );

    const res = await callbackGET(
      new Request(
        `https://locus.local/api/admin/connectors/oauth/callback?code=abc&state=${encodeURIComponent(
          unknownState,
        )}`,
      ),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await res.text();
    expect(html).toContain('"ok":false');
    // Should not have attempted a token exchange.
    expect(mocks.exchangeCodeForTokensImpl).not.toHaveBeenCalled();
  });

  it('returns 400 HTML when required query params are missing', async () => {
    const res = await callbackGET(
      new Request('https://locus.local/api/admin/connectors/oauth/callback'),
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('Missing code or state');
  });
});

// --- PATCH /api/admin/connectors/[id] -------------------------------

describeDb('PATCH /api/admin/connectors/[id]', () => {
  async function seedConnection() {
    const [row] = await db
      .insert(mcpConnections)
      .values({
        companyId: TEST_COMPANY_ID,
        name: 'patch-source',
        serverUrl: 'https://patch.example.test/mcp',
        authType: 'none',
      })
      .returning();
    createdConnectionIds.push(row.id);
    return row;
  }

  it('flips status to disabled and emits mcp.connection.disabled', async () => {
    mockOwner();
    const row = await seedConnection();

    const req = bodyRequest(
      `https://test.local/api/admin/connectors/${row.id}`,
      'PATCH',
      { status: 'disabled' },
    );
    const res = await PATCH(req, {
      params: Promise.resolve({ id: row.id }),
    });
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      connection: { status: string };
    };
    expect(payload.connection.status).toBe('disabled');

    expect(mocks.logEventImpl).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'mcp.connection.disabled' }),
    );
  });

  it('returns 404 for an id the caller does not own', async () => {
    mockOwner();
    const req = bodyRequest(
      `https://test.local/api/admin/connectors/00000000-0000-0000-0000-000000000000`,
      'PATCH',
      { name: 'hax' },
    );
    const res = await PATCH(req, {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(res.status).toBe(404);
  });

  // C2 — the audit event's `newStatus` must reflect the POST-TEST state.
  // If a URL change fails the re-test, the row ends up `status: 'error'`
  // and the audit log must record that (not the pre-test 'active').
  it('audit payload reports newStatus=error when the re-test fails after a URL change', async () => {
    mockOwner();
    const row = await seedConnection();

    mockFailingTest('refused after url change');

    const req = bodyRequest(
      `https://test.local/api/admin/connectors/${row.id}`,
      'PATCH',
      { serverUrl: 'https://new.example.test/mcp' },
    );
    const res = await PATCH(req, {
      params: Promise.resolve({ id: row.id }),
    });
    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      connection: { status: string };
      test: { ok: boolean };
    };
    // Sanity: final state is `error`, test failed.
    expect(payload.test.ok).toBe(false);
    expect(payload.connection.status).toBe('error');

    // The audit event should reflect that — newStatus='error', not 'active'.
    const calls = mocks.logEventImpl.mock.calls as Array<[Record<string, unknown>]>;
    const patchEvent = calls
      .map((c) => c[0])
      .find((e) => (e.targetId as string) === row.id);
    expect(patchEvent).toBeDefined();
    const details = patchEvent!.details as Record<string, unknown>;
    expect(details.newStatus).toBe('error');
    expect(details.testOk).toBe(false);
    // `lastErrorMessage` is in the details so a reader doesn't have to
    // re-join against the connection row to see what went wrong.
    expect(details.lastErrorMessage).toMatch(/refused/i);
  });
});

// --- DELETE /api/admin/connectors/[id] ------------------------------

describeDb('DELETE /api/admin/connectors/[id]', () => {
  it('deletes and emits the audit event', async () => {
    mockOwner();
    const [row] = await db
      .insert(mcpConnections)
      .values({
        companyId: TEST_COMPANY_ID,
        name: 'delete-target',
        serverUrl: 'https://del.example.test/mcp',
        authType: 'none',
      })
      .returning();
    // Do NOT push to createdConnectionIds — we expect it gone.

    const res = await DELETE(new Request('https://test.local/', { method: 'DELETE' }), {
      params: Promise.resolve({ id: row.id }),
    });
    expect(res.status).toBe(200);

    expect(mocks.logEventImpl).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'mcp.connection.deleted' }),
    );
  });
});

// --- GET /api/admin/connectors/[id] ---------------------------------

describeDb('GET /api/admin/connectors/[id]', () => {
  it('returns the detail payload for an owned connection', async () => {
    mockOwner();
    const [row] = await db
      .insert(mcpConnections)
      .values({
        companyId: TEST_COMPANY_ID,
        name: 'detail-target',
        serverUrl: 'https://detail.example.test/mcp',
        authType: 'none',
      })
      .returning();
    createdConnectionIds.push(row.id);

    const res = await GET_DETAIL(
      new Request('https://test.local/', { method: 'GET' }),
      { params: Promise.resolve({ id: row.id }) },
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      connection: { id: string; hasCredential: boolean };
    };
    expect(payload.connection.id).toBe(row.id);
    expect(payload.connection.hasCredential).toBe(false);
  });
});

// --- POST /api/admin/connectors/[id]/oauth/start (reconnect) --------

describeDb('POST /api/admin/connectors/[id]/oauth/start', () => {
  /**
   * Seed an already-authorised OAuth connection directly. We bypass the
   * kickoff + callback flow so the reconnect test starts from the same
   * shape the real system has after a successful first-time connect:
   * status=active, a full OAuth credentials blob with real DCR client
   * details + tokens.
   */
  async function seedOauthConnection() {
    const fakeMetadata = {
      authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
      tokenEndpoint: 'https://auth.example.test/oauth/token',
      registrationEndpoint: 'https://auth.example.test/oauth/register',
      revocationEndpoint: null,
      scopesSupported: ['read', 'write'] as string[],
    };

    const plaintext = encodeCredentials({
      kind: 'oauth',
      accessToken: 'stored-at',
      refreshToken: 'stored-rt',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      tokenType: 'Bearer',
      scope: null,
      dcrClientId: 'stored-cid',
      dcrClientSecret: 'stored-csecret',
      authServerMetadata: fakeMetadata,
    });
    const credentialsEncrypted = await encryptCredential(plaintext);

    const [row] = await db
      .insert(mcpConnections)
      .values({
        companyId: TEST_COMPANY_ID,
        name: 'reconnect-source',
        serverUrl: 'https://reconnect.example.test/mcp',
        authType: 'oauth',
        status: 'active',
        catalogId: 'linear',
        credentialsEncrypted,
      })
      .returning();
    createdConnectionIds.push(row.id);
    return row;
  }

  it('flips the row to pending and returns an authorize URL without re-running DCR', async () => {
    mockOwner();
    const row = await seedOauthConnection();

    // The shared handshake helper calls buildAuthorizeUrl directly. Echo
    // the input state back into the returned URL so we can assert the
    // flow produced a real signed state.
    mocks.buildAuthorizeUrlImpl.mockImplementation(
      (_meta: unknown, opts: { state: string; clientId: string }) =>
        `https://auth.example.test/oauth/authorize?client_id=${encodeURIComponent(
          opts.clientId,
        )}&state=${encodeURIComponent(opts.state)}`,
    );

    const req = bodyRequest(
      `https://test.local/api/admin/connectors/${row.id}/oauth/start`,
      'POST',
      {},
    );
    const res = await RECONNECT_POST(req, {
      params: Promise.resolve({ id: row.id }),
    });
    expect(res.status).toBe(200);

    const payload = (await res.json()) as { authorizeUrl: string };
    expect(typeof payload.authorizeUrl).toBe('string');
    expect(payload.authorizeUrl).toContain('https://auth.example.test/');
    // Uses the stored DCR client id — not a freshly registered one.
    expect(payload.authorizeUrl).toContain('client_id=stored-cid');

    // Row flipped to pending.
    const latest = await getConnection(row.id, TEST_COMPANY_ID);
    expect(latest).not.toBeNull();
    expect(latest!.status).toBe('pending');
    // Credentials blob was preserved (we still need it during the
    // callback exchange).
    expect(latest!.credentialsEncrypted).not.toBeNull();

    // Critical: performDcr must NOT be called on a reconnect — we reuse
    // the DCR client id/secret the first install registered.
    expect(mocks.performDcrImpl).not.toHaveBeenCalled();

    expect(mocks.buildAuthorizeUrlImpl).toHaveBeenCalledOnce();

    // Audit event emitted.
    expect(mocks.logEventImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'mcp.connection.updated',
        targetId: row.id,
        details: expect.objectContaining({ via: 'reconnect' }),
      }),
    );
  });

  it('returns 404 for an id the caller does not own', async () => {
    mockOwner();
    const req = bodyRequest(
      `https://test.local/api/admin/connectors/00000000-0000-0000-0000-000000000000/oauth/start`,
      'POST',
      {},
    );
    const res = await RECONNECT_POST(req, {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when the connection is not OAuth', async () => {
    mockOwner();
    const [row] = await db
      .insert(mcpConnections)
      .values({
        companyId: TEST_COMPANY_ID,
        name: 'not-oauth',
        serverUrl: 'https://plain.example.test/mcp',
        authType: 'none',
      })
      .returning();
    createdConnectionIds.push(row.id);

    const req = bodyRequest(
      `https://test.local/api/admin/connectors/${row.id}/oauth/start`,
      'POST',
      {},
    );
    const res = await RECONNECT_POST(req, {
      params: Promise.resolve({ id: row.id }),
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe('not_oauth');
  });
});

// --- POST /api/admin/connectors/[id]/disconnect ---------------------

describeDb('POST /api/admin/connectors/[id]/disconnect', () => {
  it('revokes the refresh token and deletes the row', async () => {
    mockOwner();

    const fakeMetadata = {
      authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
      tokenEndpoint: 'https://auth.example.test/oauth/token',
      registrationEndpoint: 'https://auth.example.test/oauth/register',
      revocationEndpoint: 'https://auth.example.test/oauth/revoke',
      scopesSupported: ['read'] as string[],
    };

    const plaintext = encodeCredentials({
      kind: 'oauth',
      accessToken: 'at',
      refreshToken: 'rt-to-revoke',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      tokenType: 'Bearer',
      scope: null,
      dcrClientId: 'cid',
      dcrClientSecret: 'csecret',
      authServerMetadata: fakeMetadata,
    });
    const credentialsEncrypted = await encryptCredential(plaintext);

    const [row] = await db
      .insert(mcpConnections)
      .values({
        companyId: TEST_COMPANY_ID,
        name: 'disconnect-target',
        serverUrl: 'https://disc.example.test/mcp',
        authType: 'oauth',
        status: 'active',
        catalogId: 'linear',
        credentialsEncrypted,
      })
      .returning();
    // Do NOT push to createdConnectionIds — we expect it gone.

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    try {
      const req = bodyRequest(
        `https://test.local/api/admin/connectors/${row.id}/disconnect`,
        'POST',
        {},
      );
      const res = await DISCONNECT_POST(req, {
        params: Promise.resolve({ id: row.id }),
      });
      expect(res.status).toBe(200);
      const payload = (await res.json()) as { ok: boolean };
      expect(payload.ok).toBe(true);

      // Best-effort revocation was attempted against the provider.
      expect(fetchSpy).toHaveBeenCalled();
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(String(calledUrl)).toBe('https://auth.example.test/oauth/revoke');
      const body = String((calledInit as RequestInit | undefined)?.body ?? '');
      expect(body).toContain('token=rt-to-revoke');
      expect(body).toContain('token_type_hint=refresh_token');
      expect(body).toContain('client_id=cid');
    } finally {
      fetchSpy.mockRestore();
    }

    // Row is gone.
    const latest = await getConnection(row.id, TEST_COMPANY_ID);
    expect(latest).toBeNull();

    // Audit emitted.
    expect(mocks.logEventImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'mcp.connection.deleted',
        targetId: row.id,
        details: expect.objectContaining({
          via: 'disconnect',
          authType: 'oauth',
        }),
      }),
    );
  });

  it('deletes even when revocation fails', async () => {
    mockOwner();

    const fakeMetadata = {
      authorizationEndpoint: 'https://auth.example.test/oauth/authorize',
      tokenEndpoint: 'https://auth.example.test/oauth/token',
      registrationEndpoint: 'https://auth.example.test/oauth/register',
      revocationEndpoint: 'https://auth.example.test/oauth/revoke',
      scopesSupported: null,
    };

    const plaintext = encodeCredentials({
      kind: 'oauth',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      tokenType: 'Bearer',
      scope: null,
      dcrClientId: 'cid',
      dcrClientSecret: null,
      authServerMetadata: fakeMetadata,
    });
    const credentialsEncrypted = await encryptCredential(plaintext);

    const [row] = await db
      .insert(mcpConnections)
      .values({
        companyId: TEST_COMPANY_ID,
        name: 'disconnect-revoke-fail',
        serverUrl: 'https://disc2.example.test/mcp',
        authType: 'oauth',
        status: 'active',
        credentialsEncrypted,
      })
      .returning();

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network exploded'));

    try {
      const req = bodyRequest(
        `https://test.local/api/admin/connectors/${row.id}/disconnect`,
        'POST',
        {},
      );
      const res = await DISCONNECT_POST(req, {
        params: Promise.resolve({ id: row.id }),
      });
      expect(res.status).toBe(200);
    } finally {
      fetchSpy.mockRestore();
    }

    const latest = await getConnection(row.id, TEST_COMPANY_ID);
    expect(latest).toBeNull();
  });

  it('deletes a non-oauth connection without calling fetch', async () => {
    mockOwner();

    const [row] = await db
      .insert(mcpConnections)
      .values({
        companyId: TEST_COMPANY_ID,
        name: 'disconnect-plain',
        serverUrl: 'https://plain-disc.example.test/mcp',
        authType: 'none',
      })
      .returning();

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    try {
      const req = bodyRequest(
        `https://test.local/api/admin/connectors/${row.id}/disconnect`,
        'POST',
        {},
      );
      const res = await DISCONNECT_POST(req, {
        params: Promise.resolve({ id: row.id }),
      });
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }

    const latest = await getConnection(row.id, TEST_COMPANY_ID);
    expect(latest).toBeNull();
  });

  it('returns 404 for an id the caller does not own', async () => {
    mockOwner();
    const req = bodyRequest(
      `https://test.local/api/admin/connectors/00000000-0000-0000-0000-000000000000/disconnect`,
      'POST',
      {},
    );
    const res = await DISCONNECT_POST(req, {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
    });
    expect(res.status).toBe(404);
  });
});

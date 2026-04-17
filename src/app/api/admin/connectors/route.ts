// Admin MCP OUT connection endpoints — list + create.
//
// GET  /api/admin/connectors  — list the caller's company's connections.
// POST /api/admin/connectors  — create a new connection, then test it.
//
// POST supports two shapes:
//   1. Catalog install: `{ catalogId, bearerToken? }`. Looks up the
//      catalog entry and branches on its `authMode`:
//        - 'oauth-dcr' → resolves metadata, performs DCR, stores a
//          pending row with DCR details, returns an authorize URL.
//        - 'bearer'    → encrypts the bearer token, stores active, tests.
//   2. Custom: `{ name, serverUrl, authType, bearerToken? }`. Same path
//      as before — insert + sync connect test.
//
// Auth: Owner-only (MCP OUT controls live data flowing from sensitive
// systems like email / CRM / accounting — only the company owner may
// configure). Other role checks are implicitly handled by `requireAuth`
// + `requireRole(..., 'owner')`.
//
// Connection test on create: after INSERT we try to connect + listTools
// synchronously. If that fails, we flip the row to `status = 'error'`,
// populate `lastErrorMessage`, and return a 200 payload that the UI can
// inspect — the row intentionally survives so the user can fix the URL
// or token via PATCH and re-test, rather than starting over.
//
// Audit: emits `mcp.connection.created` on success (with test outcome).

import { z } from 'zod';

import { logEvent } from '@/lib/audit/logger';
import { requireAuth, requireRole } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import {
  createConnection,
  encryptCredential,
  getConnection,
  installFromCatalog,
  listConnections,
  markConnectionError,
} from '@/lib/mcp-out/connections';
import {
  connectToMcpServer,
  discoverTools,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_DISCOVER_TIMEOUT_MS,
} from '@/lib/mcp-out/client';
import type { McpConnection } from '@/lib/mcp-out/types';
import {
  getCatalogEntry,
  type ConnectorCatalogEntry,
} from '@/lib/connectors/catalog';
import {
  resolveAuthServerMetadata,
  performDcr,
} from '@/lib/connectors/mcp-oauth';
import { encodeCredentials } from '@/lib/connectors/credentials';
import { buildOauthHandshake } from './_oauth-handshake';

export const runtime = 'nodejs';

// --- GET /api/admin/connectors --------------------------------------

export async function GET() {
  let ctx;
  try {
    ctx = await requireAuth();
    requireRole(ctx, 'owner');
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    throw err;
  }

  if (!ctx.companyId) {
    return Response.json(
      { error: 'no_company', message: 'Complete setup first.' },
      { status: 403 },
    );
  }

  const rows = await listConnections(ctx.companyId);
  return Response.json({
    connections: rows.map(serializeConnection),
  });
}

// --- POST /api/admin/connectors -------------------------------------

const catalogInstallSchema = z.object({
  catalogId: z.string().min(1),
  bearerToken: z.string().trim().min(1).max(4096).optional(),
});

const customInstallSchema = z.object({
  name: z.string().trim().min(1).max(100),
  serverUrl: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(
      (value) => {
        try {
          const url = new URL(value);
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

function isCatalogInstall(body: unknown): body is { catalogId: unknown } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'catalogId' in (body as object) &&
    (body as { catalogId: unknown }).catalogId !== undefined
  );
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireAuth();
    requireRole(ctx, 'owner');
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    throw err;
  }

  if (!ctx.companyId) {
    return Response.json(
      { error: 'no_company', message: 'Complete setup first.' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Request body must be JSON.' },
      { status: 400 },
    );
  }

  const origin = new URL(request.url).origin;

  if (isCatalogInstall(body)) {
    const parsed = catalogInstallSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: 'invalid_body',
          message: 'Invalid catalog install input.',
          issues: parsed.error.issues,
        },
        { status: 400 },
      );
    }
    const { catalogId, bearerToken } = parsed.data;
    const entry = getCatalogEntry(catalogId);
    if (!entry) {
      return Response.json(
        { error: 'unknown_catalog_id', message: `Unknown catalog id: ${catalogId}` },
        { status: 400 },
      );
    }

    if (entry.authMode === 'oauth-dcr') {
      const kickoff = await kickoffOauthInstall(ctx.companyId, entry, origin);
      if (!kickoff.ok) {
        return Response.json(
          {
            error: kickoff.error,
            message: kickoff.detail ?? 'OAuth install failed.',
          },
          { status: 502 },
        );
      }

      logEvent({
        companyId: ctx.companyId,
        category: 'administration',
        eventType: 'mcp.connection.created',
        actorType: 'human',
        actorId: ctx.userId,
        actorName: ctx.fullName ?? undefined,
        targetType: 'connection',
        targetId: kickoff.connection.id,
        details: {
          name: kickoff.connection.name,
          serverUrl: kickoff.connection.serverUrl,
          authType: kickoff.connection.authType,
          catalogId: entry.id,
          kickoff: 'oauth',
        },
      });

      return Response.json({
        connection: serializeConnection(kickoff.connection),
        next: { kind: 'oauth' as const, authorizeUrl: kickoff.authorizeUrl },
      });
    }

    // Catalog bearer install.
    if (!bearerToken) {
      return Response.json(
        {
          error: 'invalid_body',
          message: 'bearerToken is required for this catalog entry.',
        },
        { status: 400 },
      );
    }

    const plaintext = encodeCredentials({ kind: 'bearer', token: bearerToken });
    const credentialsEncrypted = await encryptCredential(plaintext);

    const created = await installFromCatalog({
      companyId: ctx.companyId,
      catalogId: entry.id,
      name: entry.name,
      serverUrl: entry.mcpUrl,
      authType: 'bearer',
      credentialsEncrypted,
      initialStatus: 'active',
    });

    const testResult = await testConnection(created);

    logEvent({
      companyId: ctx.companyId,
      category: 'administration',
      eventType: 'mcp.connection.created',
      actorType: 'human',
      actorId: ctx.userId,
      actorName: ctx.fullName ?? undefined,
      targetType: 'connection',
      targetId: created.id,
      details: {
        name: created.name,
        serverUrl: created.serverUrl,
        authType: created.authType,
        catalogId: entry.id,
        testOk: testResult.ok,
        testError: testResult.ok ? null : testResult.error,
      },
    });

    const latest = await getConnection(created.id, ctx.companyId);

    return Response.json({
      connection: latest ? serializeConnection(latest) : serializeConnection(created),
      test: testResult,
      next: { kind: 'done' as const },
    });
  }

  // Custom install path (unchanged behaviour from prior task).
  const parsed = customInstallSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: 'invalid_body',
        message: 'Invalid MCP connection input.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const input = parsed.data;
  if (input.authType === 'bearer' && !input.bearerToken) {
    return Response.json(
      {
        error: 'invalid_body',
        message: 'bearerToken is required when authType is "bearer".',
      },
      { status: 400 },
    );
  }

  const created = await createConnection({
    companyId: ctx.companyId,
    name: input.name,
    serverUrl: input.serverUrl,
    authType: input.authType,
    bearerToken: input.bearerToken,
  });

  // Test the connection synchronously. On failure we flip the row and
  // return 200 with a test-outcome payload — the row exists, the user
  // can PATCH the URL/token and re-test.
  const testResult = await testConnection(created);

  logEvent({
    companyId: ctx.companyId,
    category: 'administration',
    eventType: 'mcp.connection.created',
    actorType: 'human',
    actorId: ctx.userId,
    actorName: ctx.fullName ?? undefined,
    targetType: 'connection',
    targetId: created.id,
    details: {
      name: created.name,
      serverUrl: created.serverUrl,
      authType: created.authType,
      testOk: testResult.ok,
      testError: testResult.ok ? null : testResult.error,
    },
  });

  // The `created` object is pre-test; re-fetch so the response reflects
  // the post-test status (`error` if the test failed).
  const latest = await getConnection(created.id, ctx.companyId);

  return Response.json({
    connection: latest ? serializeConnection(latest) : serializeConnection(created),
    test: testResult,
  });
}

// --- helpers -------------------------------------------------------------

/**
 * Serialise a connection for the API response. We never expose the raw
 * ciphertext over the wire — the UI only needs to know whether a
 * credential is configured.
 */
function serializeConnection(c: McpConnection) {
  return {
    id: c.id,
    name: c.name,
    serverUrl: c.serverUrl,
    authType: c.authType,
    hasCredential: c.credentialsEncrypted !== null,
    status: c.status,
    lastErrorMessage: c.lastErrorMessage,
    catalogId: c.catalogId,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
  };
}

/**
 * Attempt `connectToMcpServer` + `discoverTools`. On failure, mark the
 * connection row as errored and return the sanitised message so the UI
 * can display it inline.
 *
 * Both stages run under their default 10-second per-call timeouts. A
 * TCP-responsive-but-dead external server will produce a timeout error
 * within the budget rather than hanging the entire HTTP request.
 */
async function testConnection(
  conn: McpConnection,
): Promise<{ ok: true; toolCount: number } | { ok: false; error: string }> {
  let client: Awaited<ReturnType<typeof connectToMcpServer>> | null = null;
  try {
    client = await connectToMcpServer(conn, DEFAULT_CONNECT_TIMEOUT_MS);
    const tools = await discoverTools(client, DEFAULT_DISCOVER_TIMEOUT_MS);
    return { ok: true, toolCount: tools.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed.';
    await markConnectionError(conn.id, message).catch(() => {});
    return { ok: false, error: message.slice(0, 500) };
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

/**
 * Kick off an OAuth 2.1 + DCR install for a catalog entry. On success the
 * caller should redirect the user to `authorizeUrl`; the callback route
 * at `/api/admin/connectors/oauth/callback` finishes the exchange.
 *
 * Side effects:
 *   - Writes a `pending` row to `mcp_connections` carrying the DCR
 *     client credentials + resolved metadata inside an encrypted
 *     placeholder credential.
 *   - Stores the PKCE verifier keyed by signed state so the callback can
 *     retrieve it.
 */
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

  const { authorizeUrl } = buildOauthHandshake({
    connectionId: connection.id,
    metadata: meta.metadata,
    dcrClientId: dcr.clientId,
    redirectUri,
  });

  return { ok: true, connection, authorizeUrl };
}

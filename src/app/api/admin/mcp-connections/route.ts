// Admin MCP OUT connection endpoints — list + create.
//
// GET  /api/admin/mcp-connections  — list the caller's company's connections.
// POST /api/admin/mcp-connections  — create a new connection, then test it.
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
  getConnection,
  listConnections,
  markConnectionError,
} from '@/lib/mcp-out/connections';
import { connectToMcpServer, discoverTools } from '@/lib/mcp-out/client';
import type { McpConnection } from '@/lib/mcp-out/types';

export const runtime = 'nodejs';

// --- GET /api/admin/mcp-connections --------------------------------------

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

// --- POST /api/admin/mcp-connections -------------------------------------

const createSchema = z.object({
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

  const parsed = createSchema.safeParse(body);
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
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
  };
}

/**
 * Attempt `connectToMcpServer` + `discoverTools`. On failure, mark the
 * connection row as errored and return the sanitised message so the UI
 * can display it inline.
 */
async function testConnection(
  conn: McpConnection,
): Promise<{ ok: true; toolCount: number } | { ok: false; error: string }> {
  let client: Awaited<ReturnType<typeof connectToMcpServer>> | null = null;
  try {
    client = await connectToMcpServer(conn);
    const tools = await discoverTools(client);
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

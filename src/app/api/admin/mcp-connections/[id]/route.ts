// Admin MCP OUT connection detail endpoints — detail / patch / delete.
//
// GET     /api/admin/mcp-connections/[id]   — read detail
// PATCH   /api/admin/mcp-connections/[id]   — update (name, URL, auth,
//                                             toggle status). Optionally
//                                             re-tests on URL/token change.
// DELETE  /api/admin/mcp-connections/[id]   — delete.
//
// Auth: Owner-only. Cross-tenant id guesses return 404 (not 403) to
// avoid leaking existence. Implementation: helpers already scope by
// `companyId`, so a bogus id simply returns `null` / `false`.
//
// Audit: emits `mcp.connection.updated`, `mcp.connection.enabled`,
// `mcp.connection.disabled`, `mcp.connection.deleted` depending on the
// operation.

import { z } from 'zod';

import { logEvent } from '@/lib/audit/logger';
import { requireAuth, requireRole } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import {
  deleteConnection,
  getConnection,
  markConnectionError,
  updateConnection,
} from '@/lib/mcp-out/connections';
import { connectToMcpServer, discoverTools } from '@/lib/mcp-out/client';
import type { McpConnection } from '@/lib/mcp-out/types';

export const runtime = 'nodejs';

// --- helpers -------------------------------------------------------------

type OwnerCtx = {
  userId: string;
  companyId: string;
  role: 'owner';
  fullName: string | null;
};

async function requireOwner(): Promise<OwnerCtx | Response> {
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

  return {
    userId: ctx.userId,
    companyId: ctx.companyId,
    role: 'owner',
    fullName: ctx.fullName,
  };
}

function isResponse(x: unknown): x is Response {
  return x instanceof Response;
}

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

// --- GET /api/admin/mcp-connections/[id] ---------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireOwner();
  if (isResponse(ctx)) return ctx;

  const { id } = await params;
  const conn = await getConnection(id, ctx.companyId);
  if (!conn) {
    return Response.json(
      { error: 'not_found', message: 'Connection not found.' },
      { status: 404 },
    );
  }
  return Response.json({ connection: serializeConnection(conn) });
}

// --- PATCH /api/admin/mcp-connections/[id] -------------------------------

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
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
      )
      .optional(),
    authType: z.enum(['none', 'bearer']).optional(),
    // Omit to keep existing token. `null` clears. Non-null string replaces.
    bearerToken: z.string().trim().min(0).max(4096).nullable().optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Patch body must include at least one field.',
  });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireOwner();
  if (isResponse(ctx)) return ctx;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Request body must be JSON.' },
      { status: 400 },
    );
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: 'invalid_body',
        message: 'Invalid patch input.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const existing = await getConnection(id, ctx.companyId);
  if (!existing) {
    return Response.json(
      { error: 'not_found', message: 'Connection not found.' },
      { status: 404 },
    );
  }

  const patch = parsed.data;

  // Writing a new serverUrl or token implies the user is re-testing;
  // reset the error message so a successful test can relatably clear
  // the `error` status back to `active`.
  const clearError = patch.serverUrl !== undefined || patch.bearerToken !== undefined;
  if (clearError && patch.status === undefined) {
    // Only clear if the previous status was 'error'. A user-chosen
    // 'disabled' should be preserved through a URL edit.
    if (existing.status === 'error') {
      patch.status = 'active';
    }
  }

  const updated = await updateConnection(id, ctx.companyId, {
    name: patch.name,
    serverUrl: patch.serverUrl,
    authType: patch.authType,
    bearerToken: patch.bearerToken,
    status: patch.status,
    lastErrorMessage: clearError ? null : undefined,
  });

  if (!updated) {
    // Shouldn't happen — we just verified existence — but handle defensively.
    return Response.json(
      { error: 'not_found', message: 'Connection not found.' },
      { status: 404 },
    );
  }

  // Re-test if the URL / token / authType changed OR status flipped to
  // 'active'. The test result updates the stored status via
  // markConnectionError on failure; success leaves the row alone.
  let testResult:
    | { ok: true; toolCount: number }
    | { ok: false; error: string }
    | null = null;

  const shouldTest =
    (updated.status === 'active' &&
      (patch.serverUrl !== undefined ||
        patch.bearerToken !== undefined ||
        patch.authType !== undefined ||
        existing.status === 'error')) ||
    (existing.status !== 'active' && updated.status === 'active');

  if (shouldTest) {
    testResult = await testConnection(updated);
  }

  // Audit: pick the most specific event type we can infer.
  const eventType =
    patch.status === 'disabled' && existing.status !== 'disabled'
      ? 'mcp.connection.disabled'
      : patch.status === 'active' && existing.status !== 'active'
      ? 'mcp.connection.enabled'
      : 'mcp.connection.updated';

  logEvent({
    companyId: ctx.companyId,
    category: 'administration',
    eventType,
    actorType: 'human',
    actorId: ctx.userId,
    actorName: ctx.fullName ?? undefined,
    targetType: 'connection',
    targetId: updated.id,
    details: {
      name: updated.name,
      serverUrl: updated.serverUrl,
      authType: updated.authType,
      previousStatus: existing.status,
      newStatus: updated.status,
      tested: testResult !== null,
      testOk: testResult?.ok ?? null,
    },
  });

  // Return the freshest row post-test (test may have flipped status).
  const final = (await getConnection(id, ctx.companyId)) ?? updated;
  return Response.json({
    connection: serializeConnection(final),
    test: testResult,
  });
}

// --- DELETE /api/admin/mcp-connections/[id] ------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireOwner();
  if (isResponse(ctx)) return ctx;

  const { id } = await params;

  const existing = await getConnection(id, ctx.companyId);
  if (!existing) {
    return Response.json(
      { error: 'not_found', message: 'Connection not found.' },
      { status: 404 },
    );
  }

  const ok = await deleteConnection(id, ctx.companyId);
  if (!ok) {
    return Response.json(
      { error: 'not_found', message: 'Connection not found.' },
      { status: 404 },
    );
  }

  logEvent({
    companyId: ctx.companyId,
    category: 'administration',
    eventType: 'mcp.connection.deleted',
    actorType: 'human',
    actorId: ctx.userId,
    actorName: ctx.fullName ?? undefined,
    targetType: 'connection',
    targetId: existing.id,
    details: {
      name: existing.name,
      serverUrl: existing.serverUrl,
      authType: existing.authType,
      previousStatus: existing.status,
    },
  });

  return Response.json({ ok: true });
}

// --- shared connection test ----------------------------------------------

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

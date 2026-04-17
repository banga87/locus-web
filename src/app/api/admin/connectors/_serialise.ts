// Shared serialisation + connect-test helpers for the /api/admin/connectors
// route handlers. Both live here so the two route files can't drift on
// response-shape fields (as happened pre-extract with `catalogId`).

import type { McpConnection } from '@/lib/mcp-out/types';
import {
  connectToMcpServer,
  discoverTools,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_DISCOVER_TIMEOUT_MS,
} from '@/lib/mcp-out/client';
import { markConnectionError } from '@/lib/mcp-out/connections';

export function serializeConnection(c: McpConnection) {
  return {
    id: c.id,
    catalogId: c.catalogId,
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

export async function testConnection(
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

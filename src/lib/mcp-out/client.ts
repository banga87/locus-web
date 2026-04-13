// MCP OUT client wrapper — thin adapter around `@modelcontextprotocol/sdk`
// in *client mode*. Phase 0's `src/lib/mcp/` uses the SDK in server
// mode (exposing IN); this file is the mirror image for OUT.
//
// Keep this file thin. The MCP SDK's client / transport surface
// changes between minor versions; isolating all SDK imports here means
// future churn lives in one place.
//
// Transport: `StreamableHTTPClientTransport` is the spec-compliant
// HTTP transport shape for MCP as of SDK 1.29.0. Servers that speak
// only the older SSE transport (pre-spec) are out of scope for MVP —
// users will see a connection error and can fix it when the ecosystem
// converges on streamable-http.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { decryptCredential } from './connections';
import type { McpConnection, McpOutTool } from './types';

/**
 * Open an MCP client session against a remote server. The caller owns
 * the returned `Client` and must `.close()` it (use a try/finally). On
 * bearer-auth connections we decrypt the stored credential and inject
 * it as `Authorization: Bearer ...` via the transport's `requestInit`.
 */
export async function connectToMcpServer(conn: McpConnection): Promise<Client> {
  const url = new URL(conn.serverUrl);

  const headers: Record<string, string> = {};
  if (conn.authType === 'bearer' && conn.credentialsEncrypted) {
    const token = await decryptCredential(conn.credentialsEncrypted);
    headers['Authorization'] = `Bearer ${token}`;
  }

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers },
  });

  const client = new Client(
    { name: 'locus-platform-agent', version: '0.1.0' },
    { capabilities: {} },
  );

  await client.connect(transport);
  return client;
}

/**
 * Call `listTools()` on a connected client and return a normalised
 * descriptor list. The SDK's native `Tool` type is richer than what we
 * need — we strip it down to name / description / inputSchema so the
 * bridge layer doesn't leak SDK internals.
 */
export async function discoverTools(client: Client): Promise<McpOutTool[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
  }));
}

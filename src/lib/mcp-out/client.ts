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
//
// Timeouts: every external call accepts an explicit `timeoutMs`. The
// MCP SDK's `RequestOptions` exposes both `signal` and `timeout`; we
// pass both so (a) we control the underlying fetch via AbortSignal and
// (b) the SDK surfaces a `RequestTimeout` McpError if the transport
// stalls. The `connect` path additionally wraps with Promise.race as
// belt-and-braces because some transports buffer on the handshake and
// do not honour signals uniformly. See Phase 1 plan risk register
// (lines 1567-1572) for the motivating scenario: a TCP-responsive but
// application-dead external server consuming the entire
// `maxDuration = 120s` chat turn.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { decryptCredential } from './connections';
import type { McpConnection, McpOutTool } from './types';

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_DISCOVER_TIMEOUT_MS = 10_000;

/**
 * Open an MCP client session against a remote server. The caller owns
 * the returned `Client` and must `.close()` it (use a try/finally). On
 * bearer-auth connections we decrypt the stored credential and inject
 * it as `Authorization: Bearer ...` via the transport's `requestInit`.
 *
 * `timeoutMs` caps the entire connect handshake — including the TCP
 * open, TLS, and MCP `initialize` round-trip.
 */
export async function connectToMcpServer(
  conn: McpConnection,
  timeoutMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): Promise<Client> {
  const url = new URL(conn.serverUrl);

  const headers: Record<string, string> = {};
  if (conn.authType === 'bearer' && conn.credentialsEncrypted) {
    const token = await decryptCredential(conn.credentialsEncrypted);
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers, signal: controller.signal },
  });

  const client = new Client(
    { name: 'locus-platform-agent', version: '0.1.0' },
    { capabilities: {} },
  );

  try {
    // Pass the same signal + timeout into the SDK. Belt-and-braces:
    // the SDK wraps the request, but some transports buffer early, so
    // a wrapping race guarantees an upper bound on `connect()`'s
    // wall-clock duration regardless of SDK internals.
    await raceWithTimeout(
      client.connect(transport, {
        signal: controller.signal,
        timeout: timeoutMs,
      }),
      timeoutMs,
      `MCP connect timeout after ${timeoutMs}ms`,
    );
    return client;
  } catch (err) {
    // Best-effort transport cleanup if we threw before handing the
    // client back to the caller.
    await client.close().catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call `listTools()` on a connected client and return a normalised
 * descriptor list. The SDK's native `Tool` type is richer than what we
 * need — we strip it down to name / description / inputSchema so the
 * bridge layer doesn't leak SDK internals.
 *
 * `timeoutMs` caps the individual RPC. The SDK raises a RequestTimeout
 * McpError if the server doesn't respond in time.
 */
export async function discoverTools(
  client: Client,
  timeoutMs: number = DEFAULT_DISCOVER_TIMEOUT_MS,
): Promise<McpOutTool[]> {
  const { tools } = await client.listTools(undefined, { timeout: timeoutMs });
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
  }));
}

/**
 * Wrap a promise with a wall-clock timeout. Used for `client.connect()`
 * (above) and as a utility for callers of `bridge.ts` that need to cap
 * the end-to-end duration of a connect+discover composition.
 */
export function raceWithTimeout<T>(
  inner: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([inner, timeout]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

// MCP OUT → AI SDK tool bridge.
//
// Task 3 replaces the Task 1 stub. The flow on every chat turn:
//
//   1. `loadMcpOutTools(companyId)` reads active `mcp_connections`.
//   2. For each, we connect + listTools() under a `DISCOVER_TIMEOUT_MS`
//      wall-clock budget, and wrap each remote tool as an AI SDK
//      `dynamicTool`. Namespaced as `ext_<connPrefix>_<safeName>` to
//      prevent collisions between external servers (and with brain
//      tools).
//   3. Errors on one connection never sink the others — a failing
//      connection gets flipped to `status = 'error'` with a message,
//      and the healthy connections keep going (`Promise.all` with
//      per-branch try/catch).
//   4. The wrapped tools close over a per-request `Client` instance
//      that stays open for the lifetime of the caller's turn. The
//      caller receives an explicit `close()` callback and MUST invoke
//      it (typically in a `finally` or under `waitUntil`) so that
//      transports are released deterministically rather than relying on
//      GC — Vercel functions can shut down aggressively after the
//      response stream ends.
//
// Timeouts (added in review pass — Phase 1 plan risk register, lines 1567 to 1572):
//   - Discovery (connect + listTools) is capped at DISCOVER_TIMEOUT_MS.
//     A stalled external server with a live TCP connection used to
//     consume the entire chat function budget; it now caps at ten
//     seconds per connection, isolated from healthy connections.
//   - Each bridged tool's `execute` caps `callTool` at
//     TOOL_CALL_TIMEOUT_MS. On timeout we return a structured error
//     (not a throw) so the LLM can recover mid-turn.
//
// Tool name sanitisation:
//   LLM providers require tool names match `[a-zA-Z0-9_-]{1,64}`. The
//   external server's name is arbitrary so we sanitise (replace
//   non-conforming chars with `_`) and truncate (>64 chars would crash
//   the turn).
//
// v6 idiom: we wrap external schemas with `jsonSchema()` and pass them
// through `dynamicTool({ inputSchema, execute })` — same pattern Task
// 1 established in `src/lib/agent/tool-bridge.ts`. There is NO
// jsonSchemaToZod converter — v6's `jsonSchema()` accepts JSONSchema7
// directly.
//
// Cache: per-request. Nothing persists across requests. If the hot
// path becomes too slow we'd lift this to an in-process LRU keyed by
// connection id + token — but that's a Phase 2 optimisation.

import { waitUntil } from '@vercel/functions';
import { dynamicTool, jsonSchema, type Tool } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';

import type { McpToolMeta } from '@/lib/agent/tool-bridge';
import {
  listConnections,
  markConnectionError,
  touchConnection,
} from './connections';
import {
  connectToMcpServer,
  discoverTools,
  raceWithTimeout,
} from './client';
import type { McpConnection } from './types';

/** Total wall-clock budget for connect + listTools per connection. */
export const DISCOVER_TIMEOUT_MS = 10_000;
/** Wall-clock budget for a single `callTool` during the chat loop. */
export const TOOL_CALL_TIMEOUT_MS = 30_000;

/**
 * Per-connection summary passed to the system prompt so the LLM can see
 * which external tools belong to which server (e.g. "Linear", "Notion").
 * Without this grouping the prompt would list namespaced `ext_<hex>_...`
 * keys with no hint at their origin and the model tends to ignore them.
 */
export interface ConnectionToolGroup {
  connectionId: string;
  connectionName: string;
  catalogId: string | null;
  tools: Array<{ key: string; description: string }>;
}

export interface LoadMcpOutToolsResult {
  /** Map of AI SDK tool definitions keyed by namespaced tool id. */
  tools: Record<string, Tool>;
  /**
   * Audit metadata for each tool key. Passed through to `buildToolSet`
   * so MCP tool invocations emit paired `mcp_invocation` audit events.
   */
  toolMeta: Record<string, McpToolMeta>;
  /**
   * Per-connection summaries for system-prompt rendering. Only includes
   * connections whose discovery succeeded — a failed connection is
   * flipped to `status = 'error'` and contributes nothing here.
   */
  connections: ConnectionToolGroup[];
  /**
   * Release all open MCP client transports opened during discovery.
   * Safe to call exactly once; subsequent calls are no-ops. Swallows
   * individual close errors so a single misbehaving transport can't
   * block the others.
   */
  close: () => Promise<void>;
}

/**
 * Discover and bridge the MCP OUT tools available to a company.
 *
 * Return shape: `{ tools, close }`. Callers MUST invoke `close()` in a
 * terminal path (finally, or via waitUntil after the streaming
 * response) so that per-request transports are released. See
 * `src/app/api/agent/chat/route.ts` for the expected usage.
 *
 * Errors are isolated per-connection and do not throw out of this
 * function. Callers always receive a valid (possibly empty) map.
 */
export async function loadMcpOutTools(
  companyId: string,
): Promise<LoadMcpOutToolsResult> {
  const conns = await listConnections(companyId, /* activeOnly */ true);

  const tools: Record<string, Tool> = {};
  const toolMeta: Record<string, McpToolMeta> = {};
  const connections: ConnectionToolGroup[] = [];
  const openClients: Array<Awaited<ReturnType<typeof connectToMcpServer>>> = [];

  await Promise.all(
    conns.map((conn) => loadOne(conn, tools, toolMeta, connections, openClients)),
  );

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // Close in parallel — individual failures must not block the rest.
    await Promise.all(
      openClients.map((c) =>
        c.close().catch((err: unknown) => {
          console.warn('[mcp-out] client.close() failed', err);
        }),
      ),
    );
  };

  return { tools, toolMeta, connections, close };
}

async function loadOne(
  conn: McpConnection,
  tools: Record<string, Tool>,
  toolMeta: Record<string, McpToolMeta>,
  connections: ConnectionToolGroup[],
  openClients: Array<Awaited<ReturnType<typeof connectToMcpServer>>>,
): Promise<void> {
  let client: Awaited<ReturnType<typeof connectToMcpServer>> | null = null;
  let keepOpen = false;

  try {
    // Wall-clock cap on the entire connect+listTools composition. If
    // any stage exceeds this budget we bail with an explicit timeout
    // error rather than stalling the chat turn. Each inner stage also
    // has its own timeout, but this outer race is the final safety net.
    const discovered = await raceWithTimeout(
      (async () => {
        client = await connectToMcpServer(conn, DISCOVER_TIMEOUT_MS);
        const remoteTools = await discoverTools(client, DISCOVER_TIMEOUT_MS);
        return { client, remoteTools };
      })(),
      DISCOVER_TIMEOUT_MS,
      `listTools timeout after ${DISCOVER_TIMEOUT_MS}ms`,
    );

    const activeClient = discovered.client;
    const groupTools: ConnectionToolGroup['tools'] = [];

    for (const rt of discovered.remoteTools) {
      const toolKey = buildToolKey(conn.id, rt.name);
      if (toolKey !== `ext_${shortConnPrefix(conn.id)}_${rt.name}`) {
        // Sanitisation fired — name contained chars outside
        // `[a-zA-Z0-9_-]` or exceeded the 64-char ceiling.
        console.warn(
          `[mcp-out] sanitised tool name "${rt.name}" → "${toolKey}" for connection ${conn.id}`,
        );
      }

      const description =
        rt.description ?? `External tool from ${conn.name} (${rt.name}).`;
      groupTools.push({ key: toolKey, description });
      toolMeta[toolKey] = {
        mcpConnectionId: conn.id,
        mcpName: conn.name,
      };

      tools[toolKey] = dynamicTool({
        description,
        inputSchema: jsonSchema(
          (rt.inputSchema as JSONSchema7 | undefined) ?? {
            type: 'object',
            properties: {},
          },
        ),
        execute: async (args) => {
          try {
            // Cap the per-call RPC. On timeout we return a structured
            // error rather than throwing — the LLM can read it and
            // adapt (retry with different args, tell the user, etc.).
            const result = await raceWithTimeout(
              activeClient.callTool(
                {
                  name: rt.name,
                  arguments: (args ?? {}) as Record<string, unknown>,
                },
                undefined,
                { timeout: TOOL_CALL_TIMEOUT_MS },
              ),
              TOOL_CALL_TIMEOUT_MS,
              `External tool call timed out after ${TOOL_CALL_TIMEOUT_MS}ms`,
            );

            // MCP tools signal application-layer errors by setting
            // `isError: true` on the CallToolResult (the transport
            // itself succeeded, so no exception is thrown). Log these
            // at error level so we see the provider's actual message in
            // Axiom — otherwise the audit log shows `complete` for a
            // failed call and the LLM's "Not connected"-style paraphrase
            // is our only signal.
            if (result && typeof result === 'object' && 'isError' in result && (result as { isError?: unknown }).isError) {
              const text = extractToolResultText(result);
              console.error(
                `[mcp-out] ${conn.name}/${rt.name} returned isError: ${text}`,
              );
            }

            return result;
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'External tool call failed.';
            const timedOut = /timed? ?out/i.test(message);
            return {
              error: true,
              code: timedOut ? 'timeout' : 'execution_error',
              message: timedOut
                ? `External tool call timed out after ${TOOL_CALL_TIMEOUT_MS}ms`
                : message,
            };
          }
        },
      });
    }

    // Register this client for deterministic close by the caller.
    openClients.push(activeClient);
    keepOpen = true;

    // Record the per-connection summary for the system prompt.
    connections.push({
      connectionId: conn.id,
      connectionName: conn.name,
      catalogId: conn.catalogId,
      tools: groupTools,
    });

    // Non-blocking bump of `last_used_at`. A DB blip should not slow
    // down the chat turn; waitUntil keeps the write alive past the
    // response stream without adding to its critical path.
    waitUntil(
      touchConnection(conn.id).catch((err) => {
        console.warn('[mcp-out] touchConnection failed', err);
      }),
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown MCP connection error.';
    console.error(
      `[mcp-out] failed to load tools from ${conn.name} (${conn.id}): ${message}`,
    );
    // Non-blocking error flip. The caller's chat turn must not wait on
    // the DB write to surface healthy-connection tools.
    waitUntil(
      markConnectionError(conn.id, message).catch((markErr) => {
        console.warn('[mcp-out] markConnectionError failed', markErr);
      }),
    );
  } finally {
    // Note: `client` widens back to the declared union type across the
    // catch boundary — we explicitly re-type via a narrowed local so
    // the `.close()` call compiles.
    const c = client as Awaited<ReturnType<typeof connectToMcpServer>> | null;
    if (c && !keepOpen) {
      // We opened a transport but won't register it — close it right
      // away so a dead server's half-open socket doesn't leak.
      await c.close().catch(() => {});
    }
  }
}

// --- Tool-name utilities ------------------------------------------------

/**
 * Build a namespaced tool key for a discovered remote tool. Target
 * shape: `ext_<12-hex-chars>_<remoteName>` with the final string
 * clamped to ≤ 64 chars (LLM provider ceiling).
 *
 * Exported so tests can exercise it directly; kept deterministic so a
 * given (connId, remoteName) always maps to the same key.
 */
export function buildToolKey(connId: string, remoteName: string): string {
  const safeName = sanitizeToolName(remoteName);
  const prefix = shortConnPrefix(connId);
  const full = `ext_${prefix}_${safeName}`;
  return full.slice(0, 64);
}

/** Remove non-conforming chars and truncate to fit within the 64-char ceiling. */
function sanitizeToolName(name: string): string {
  // 64 - "ext_".length - "<12>".length - "_".length = 47 chars remain,
  // but we leave a little extra slack (40) so we never blow the ceiling
  // even if `conn.id` representation changes.
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

/** First 12 hex chars of a UUID with hyphens removed. */
function shortConnPrefix(connId: string): string {
  return connId.replace(/-/g, '').slice(0, 12);
}

/**
 * Extract a human-readable message from an MCP `CallToolResult`. The
 * shape is `{ content: Content[], isError?: boolean }` where `Content`
 * variants include `{ type: 'text', text: string }`. We flatten all text
 * parts; non-text parts are omitted. Used for logging only — do not
 * mutate the result returned to the caller.
 */
function extractToolResultText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.join(' ').slice(0, 500);
}

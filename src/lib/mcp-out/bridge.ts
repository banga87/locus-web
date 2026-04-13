// MCP OUT → AI SDK tool bridge.
//
// Task 3 replaces the Task 1 stub. The flow on every chat turn:
//
//   1. `loadMcpOutTools(companyId)` reads active `mcp_connections`.
//   2. For each, we connect, listTools(), and wrap each remote tool as
//      an AI SDK `dynamicTool`. Namespaced as `ext_${connId}_${name}`
//      to prevent collisions between external servers (and with brain
//      tools).
//   3. Errors on one connection never sink the others — a failing
//      connection gets flipped to `status = 'error'` with a message,
//      and the healthy connections keep going (`Promise.all` with
//      per-branch try/catch).
//   4. The wrapped tools close over a per-request `Client` instance
//      that stays open for the lifetime of the `loadMcpOutTools()`
//      call's consumer (the chat route's `runAgentTurn`). When the
//      request ends, the clients are GC'd along with the response.
//      This follows the plan's explicit choice of "connect once per
//      request, reuse the client from execute()" — simpler than
//      lazy-connect-per-tool-call and fast enough for MVP.
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

import { dynamicTool, jsonSchema, type Tool } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';

import {
  listConnections,
  markConnectionError,
  touchConnection,
} from './connections';
import { connectToMcpServer, discoverTools } from './client';
import type { McpConnection } from './types';

/**
 * Discover and bridge the MCP OUT tools available to a company.
 *
 * Return shape matches `src/lib/agent/tool-bridge.ts#buildToolSet`'s
 * `externalTools` parameter: a plain map of unique tool names to
 * `Tool` definitions ready to be spread into `streamText`'s `tools`.
 *
 * Errors are isolated per-connection and do not throw out of this
 * function. Callers always receive a valid (possibly empty) map.
 */
export async function loadMcpOutTools(
  companyId: string,
): Promise<Record<string, Tool>> {
  const conns = await listConnections(companyId, /* activeOnly */ true);

  const tools: Record<string, Tool> = {};

  await Promise.all(conns.map((conn) => loadOne(conn, tools)));

  return tools;
}

async function loadOne(
  conn: McpConnection,
  tools: Record<string, Tool>,
): Promise<void> {
  let client: Awaited<ReturnType<typeof connectToMcpServer>> | null = null;

  try {
    client = await connectToMcpServer(conn);
    const remoteTools = await discoverTools(client);

    // Capture the client reference in this closure so the execute
    // handlers below reuse the same connection across tool calls
    // within the turn. When the chat function returns the response
    // stream, this closure goes out of scope and the transport is
    // collected.
    const activeClient = client;

    for (const rt of remoteTools) {
      const toolKey = `ext_${conn.id}_${rt.name}`;

      tools[toolKey] = dynamicTool({
        description:
          rt.description ?? `External tool from ${conn.name} (${rt.name}).`,
        inputSchema: jsonSchema(
          (rt.inputSchema as JSONSchema7 | undefined) ?? {
            type: 'object',
            properties: {},
          },
        ),
        execute: async (args) => {
          try {
            const result = await activeClient.callTool({
              name: rt.name,
              arguments: (args ?? {}) as Record<string, unknown>,
            });
            return result;
          } catch (err) {
            // Surface the error as the tool result rather than
            // throwing — Task 1's tool-bridge uses the same pattern,
            // and it lets the LLM recover conversationally ("that
            // failed; let me try a different approach").
            const message =
              err instanceof Error ? err.message : 'External tool call failed.';
            return { error: true, message };
          }
        },
      });
    }

    // Fire-and-forget bump — intentionally awaited because DB writes
    // against a warm postgres-js pool are ~1-3ms and we want bounded
    // lifetime for the function invocation.
    await touchConnection(conn.id).catch((err) => {
      console.warn('[mcp-out] touchConnection failed', err);
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown MCP connection error.';
    console.error(
      `[mcp-out] failed to load tools from ${conn.name} (${conn.id}): ${message}`,
    );
    await markConnectionError(conn.id, message).catch((markErr) => {
      console.warn('[mcp-out] markConnectionError failed', markErr);
    });
    // Best-effort close if we opened a client before failing during
    // discovery.
    if (client) {
      await client.close().catch(() => {});
      client = null;
    }
  }
}

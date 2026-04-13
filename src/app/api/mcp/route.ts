// MCP StreamableHTTP endpoint.
//
// Mounted at /api/mcp. Accepts POST (MCP JSON-RPC) and DELETE (session
// cleanup — no-op since we run stateless). External agents authenticate
// via `Authorization: Bearer lat_live_...`; see `src/lib/mcp/auth.ts`.
//
// Runtime notes:
//   - `runtime = 'nodejs'` because `@vercel/functions` `waitUntil` is
//     Node-only, and the MCP SDK's transport uses Node-flavored APIs
//     even in its Web-Standard variant (the `postgres` driver also
//     requires Node).
//   - `maxDuration = 60` gives a tool call room without blocking a
//     future streaming response.
//   - A fresh `McpServer` is constructed per request. Registration is
//     cheap (in-memory tool map) and the stateless model makes any
//     cross-request reuse actively dangerous.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { waitUntil } from '@vercel/functions';

import { registerMcpTools } from '@/lib/mcp/tools';
import { flushEvents } from '@/lib/audit/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const server = new McpServer({ name: 'locus-brain', version: '0.1.0' });
  registerMcpTools(server, request);

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode — every request carries its own auth and parameters.
    sessionIdGenerator: undefined,
    // Return JSON responses instead of SSE streams. Simpler semantics for
    // the Pre-MVP read tools; we can flip this on when streaming tools land.
    enableJsonResponse: true,
  });

  await server.connect(transport);

  const response = await transport.handleRequest(request);

  // Flush audit events after the response headers are sent. The platform
  // keeps the function alive until the returned promise resolves.
  waitUntil(flushEvents());

  return response;
}

export async function DELETE(): Promise<Response> {
  // Stateless transport — no session to clean up.
  return new Response(null, { status: 200 });
}

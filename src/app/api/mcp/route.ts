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

import { authenticateAgentToken } from '@/lib/mcp/auth';
import { registerMcpTools } from '@/lib/mcp/tools';
import { flushEvents } from '@/lib/audit/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Build the WWW-Authenticate challenge returned on resource-level 401s.
 * The `resource_metadata` parameter is the RFC 9728 pointer that lets MCP
 * clients discover our OAuth authorization server without a pre-shared URL.
 */
function buildWwwAuthenticate(): string {
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://locus.app';
  return `Bearer realm="locus", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

export async function POST(request: Request): Promise<Response> {
  // Resource-level auth check. MCP discovery requires an HTTP 401 with
  // a WWW-Authenticate header when the request is unauthenticated — the
  // in-band JSON-RPC error envelope that `handleToolCall` emits on auth
  // failure is for tool-layer errors, not for transport bootstrap.
  //
  // We still let authenticated requests fall through to the transport:
  // per-call auth happens again inside `handleToolCall` so revocations
  // take effect on the very next tool call (see `src/lib/mcp/auth.ts`).
  const auth = await authenticateAgentToken(request);
  if (!auth.ok) {
    waitUntil(flushEvents());
    return Response.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: auth.message,
          data: { code: auth.code },
        },
        id: null,
      },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': buildWwwAuthenticate(),
        },
      },
    );
  }

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

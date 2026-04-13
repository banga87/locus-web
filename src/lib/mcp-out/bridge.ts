// MCP OUT tool bridge — Task 3 will replace this stub with the real
// implementation that connects to each company's `mcp_connections`,
// discovers their tools via the MCP SDK, and wraps them as AI SDK tools
// for `streamText`.
//
// Phase 1 ships with the chat route already calling `loadMcpOutTools()`
// so Task 3 is a one-module swap. Until then:
//   - `loadMcpOutTools()` returns {} — Platform Agent only sees the four
//     brain read tools.

import type { Tool } from 'ai';

/**
 * Discover and bridge the MCP OUT tools available to a company.
 *
 * Stub: returns {}. Task 3 will read `mcp_connections`, open client
 * transports, list tools, and wrap each as a `tool()` for streamText.
 */
export async function loadMcpOutTools(
  _companyId: string,
): Promise<Record<string, Tool>> {
  return {};
}

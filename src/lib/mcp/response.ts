// Format ToolResult values as MCP "content" response envelopes.
//
// MCP tool handlers return `{ content: [{ type: 'text', text: string }], isError? }`.
// The executor returns a structured `ToolResult<T>`; we serialize its
// payload (data on success, error object on failure) as JSON text so MCP
// clients can consume it with a single JSON.parse.
//
// NO rate-limit metadata is emitted — MCP is free for Pre-MVP per ADR-003.

import type { ToolResult } from '@/lib/tools/types';

// The MCP SDK's `CallToolResult` carries an index signature for future
// extension fields. Mirror it here so handler return types satisfy the
// SDK's tool callback signature without casting.
export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [extension: string]: unknown;
}

/** Format a Tool Executor result as an MCP response envelope. */
export function formatMcpResponse(result: ToolResult): McpToolResponse {
  if (result.success) {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result.error) }],
    isError: true,
  };
}

/**
 * Format a pre-executor failure (e.g., auth rejection) as an MCP response
 * envelope. Structured identically to a tool error so downstream LLMs
 * don't have to branch on shape.
 */
export function formatMcpError(code: string, message: string): McpToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify({ code, message }) }],
    isError: true,
  };
}

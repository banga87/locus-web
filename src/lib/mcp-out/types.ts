// Type definitions for the MCP OUT subsystem.
//
// `McpConnection` is the in-memory shape used by the connection
// helpers + bridge — it mirrors the row returned by Drizzle's select
// from the `mcp_connections` table so we don't have to pass that
// (conditionally-typed) inference type around.
//
// `McpOutTool` is a lightweight descriptor for a tool discovered from
// a remote MCP server. The AI SDK's `tool()` wrappers close over these
// at runtime — the type exists so bridge / client helpers can trade in
// plain objects without leaning on the SDK's `ListToolsResult` shape.

export type McpConnectionAuthType = 'none' | 'bearer';
export type McpConnectionStatus = 'active' | 'disabled' | 'error';

export interface McpConnection {
  id: string;
  companyId: string;
  name: string;
  serverUrl: string;
  authType: McpConnectionAuthType;
  /** Nullable — present only when `authType = 'bearer'`. */
  credentialsEncrypted: Buffer | null;
  status: McpConnectionStatus;
  lastErrorMessage: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * Minimal shape of a tool as discovered via the MCP SDK client's
 * `listTools()`. The MCP SDK's native type is considerably richer, but
 * we only consume the fields below in Phase 1.
 */
export interface McpOutTool {
  name: string;
  description?: string;
  // MCP's spec constrains inputSchema to an `object` type at the top
  // level. We keep it as `unknown` to stay compatible with the v6
  // `jsonSchema()` helper, which accepts JSONSchema7.
  inputSchema: unknown;
}

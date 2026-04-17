// Client-side shape of an MCP connection as serialised by the page
// Server Component and the API routes. Separate from
// `src/lib/mcp-out/types.ts`'s `McpConnection` because the client never
// sees the ciphertext Buffer and dates are transported as ISO strings.

export interface ClientMcpConnection {
  id: string;
  name: string;
  serverUrl: string;
  authType: 'none' | 'bearer' | 'oauth';
  hasCredential: boolean;
  status: 'active' | 'disabled' | 'error' | 'pending';
  lastErrorMessage: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

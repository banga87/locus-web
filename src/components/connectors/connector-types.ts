// Client-side connector shape passed from the server page component into
// the list. Mirrors the server `McpConnection` but strips the ciphertext
// and serialises dates — `Buffer` and `Date` don't cross the RSC boundary.

export interface ClientConnector {
  id: string;
  catalogId: string | null;
  name: string;
  serverUrl: string;
  authType: 'none' | 'bearer' | 'oauth';
  status: 'active' | 'disabled' | 'error' | 'pending';
  hasCredential: boolean;
  lastErrorMessage: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

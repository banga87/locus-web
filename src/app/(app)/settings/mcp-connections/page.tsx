// MCP Connections settings page. Owner-only. Fetches active
// connections server-side and renders the list component. Adding /
// editing / deleting is handled client-side via the list + dialog
// components and the /api/admin/mcp-connections endpoints.

import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/api/auth';
import { listConnections } from '@/lib/mcp-out/connections';
import { McpConnectionList } from '@/components/settings/mcp-connection-list';
import { McpConnectionDialog } from '@/components/settings/mcp-connection-dialog';

export default async function McpConnectionsPage() {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  // Mirrors the API's `requireRole(ctx, 'owner')`. Non-owners shouldn't
  // know the page exists.
  if (ctx.role !== 'owner') return notFound();

  const rows = await listConnections(ctx.companyId);
  // Sort newest-first. The helper returns unordered for simplicity.
  rows.sort((a, b) => +b.createdAt - +a.createdAt);

  // Strip the ciphertext before passing to the client — we never render
  // it, and `Buffer` is not serialisable to RSC props anyway.
  const clientRows = rows.map((c) => ({
    id: c.id,
    name: c.name,
    serverUrl: c.serverUrl,
    authType: c.authType,
    hasCredential: c.credentialsEncrypted !== null,
    status: c.status,
    lastErrorMessage: c.lastErrorMessage,
    createdAt: c.createdAt.toISOString(),
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            MCP connections
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            External MCP servers your Platform Agent can call during a chat.
            Add services like Gmail, HubSpot, or Xero that expose an MCP
            endpoint.
          </p>
        </div>
        <McpConnectionDialog mode="create" />
      </header>
      <McpConnectionList connections={clientRows} />
    </div>
  );
}

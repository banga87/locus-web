// Connectors page. Owner-only. Fetches the company's connections
// server-side and renders the minimal list. Richer tile / add-dialog UI
// ships in Tasks 15-17; this task just makes `/connectors` stop 404'ing.

import { notFound } from 'next/navigation';

import { requireAuth } from '@/lib/api/auth';
import { listConnections } from '@/lib/mcp-out/connections';
import { ConnectorList } from '@/components/connectors/connector-list';

export default async function ConnectorsPage() {
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
  const serialised = rows.map((c) => ({
    id: c.id,
    catalogId: c.catalogId,
    name: c.name,
    serverUrl: c.serverUrl,
    authType: c.authType,
    status: c.status,
    hasCredential: c.credentialsEncrypted !== null,
    lastErrorMessage: c.lastErrorMessage,
    createdAt: c.createdAt.toISOString(),
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          External tools your Platform Agent can call during a chat.
        </p>
      </header>
      <ConnectorList
        connectors={serialised}
        autoOpenAddModal={serialised.length === 0}
      />
    </div>
  );
}

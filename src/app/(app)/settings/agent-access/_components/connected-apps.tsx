'use client';

// Client-side render + disconnect interaction for the user's connected
// MCP clients. Server passes the rows in; we own the POST to
// /api/admin/oauth-connections/disconnect and router.refresh() after.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

export interface OauthConnectionRow {
  clientId: string;
  clientName: string;
  connectedAt: string; // ISO
  lastUsedAt: string | null; // ISO or null
}

interface Props {
  connections: OauthConnectionRow[];
}

export function ConnectedApps({ connections }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function disconnect(clientId: string, clientName: string) {
    if (
      !confirm(
        `Disconnect ${clientName}? It will need to reconnect to access your data.`,
      )
    )
      return;
    setPendingId(clientId);
    try {
      const res = await fetch('/api/admin/oauth-connections/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error('[agent-access] disconnect failed', err);
      alert('Failed to disconnect.');
    } finally {
      setPendingId(null);
    }
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No connected apps yet. MCP clients like Claude Code or Cursor will
        appear here after you sign them in.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">App</th>
            <th className="px-4 py-2 font-medium">Connected</th>
            <th className="px-4 py-2 font-medium">Last used</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => (
            <tr key={c.clientId} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-medium">{c.clientName}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(c.connectedAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {c.lastUsedAt
                  ? new Date(c.lastUsedAt).toLocaleString()
                  : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => disconnect(c.clientId, c.clientName)}
                  disabled={pendingId === c.clientId || isPending}
                >
                  {pendingId === c.clientId ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

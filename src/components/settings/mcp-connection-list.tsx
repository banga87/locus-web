'use client';

// MCP connection list table. Server passes serialised rows in. The
// component owns toggle + delete interactions, and delegates add / edit
// to the dialog component it composes in the actions cell.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { McpConnectionDialog } from './mcp-connection-dialog';
import type { ClientMcpConnection } from './mcp-connection-types';

interface Props {
  connections: ClientMcpConnection[];
}

export function McpConnectionList({ connections }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function toggleStatus(conn: ClientMcpConnection) {
    const nextStatus = conn.status === 'active' ? 'disabled' : 'active';
    setPendingId(conn.id);
    try {
      const res = await fetch(`/api/admin/connectors/${conn.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error('[mcp-connections] toggle failed', err);
      alert('Failed to update connection status.');
    } finally {
      setPendingId(null);
    }
  }

  async function deleteConnection(conn: ClientMcpConnection) {
    if (
      !confirm(
        `Delete "${conn.name}"? The Platform Agent will immediately lose access to the tools from this server.`,
      )
    ) {
      return;
    }
    setPendingId(conn.id);
    try {
      const res = await fetch(`/api/admin/connectors/${conn.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error('[mcp-connections] delete failed', err);
      alert('Failed to delete connection.');
    } finally {
      setPendingId(null);
    }
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No MCP connections yet. Add one to let the Platform Agent call
        external tools.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Server URL</th>
            <th className="px-4 py-2 font-medium">Auth</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Last used</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => {
            const busy = pendingId === c.id || isPending;
            return (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  <span className="block max-w-[24ch] truncate" title={c.serverUrl}>
                    {c.serverUrl}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {c.authType === 'bearer' ? 'Bearer token' : 'None'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} />
                  {c.status === 'error' && c.lastErrorMessage && (
                    <div
                      className="mt-1 max-w-[32ch] truncate text-xs text-destructive"
                      title={c.lastErrorMessage}
                    >
                      {c.lastErrorMessage}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {c.lastUsedAt
                    ? new Date(c.lastUsedAt).toLocaleDateString()
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <McpConnectionDialog mode="edit" connection={c} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleStatus(c)}
                      disabled={busy || c.status === 'error'}
                      title={
                        c.status === 'error'
                          ? 'Edit the connection to fix the error first.'
                          : undefined
                      }
                    >
                      {c.status === 'active' ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteConnection(c)}
                      disabled={busy}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: ClientMcpConnection['status'] }) {
  if (status === 'active') {
    return <Badge variant="default">Active</Badge>;
  }
  if (status === 'disabled') {
    return <Badge variant="secondary">Disabled</Badge>;
  }
  return <Badge variant="destructive">Error</Badge>;
}

'use client';

// Minimal connector list. Mirrors `mcp-connection-list.tsx` but:
//   - Shows the catalog icon (or a Lucide `Plug` icon for custom rows).
//   - Replaces Delete with a Disconnect button hitting the disconnect
//     endpoint (clears credentials, keeps the row around).
//   - Keeps the Enable/Disable toggle on PATCH status.
//
// The richer tile-picker / custom-connector dialog arrives in Task 16 —
// until then `+ Add connector` surfaces a placeholder alert so the page
// compiles and is clickable.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Plug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getCatalogEntry } from '@/lib/connectors/catalog';

import type { ClientConnector } from './connector-types';

interface Props {
  connectors: ClientConnector[];
  /**
   * Reserved for Task 16: auto-open the Add dialog on empty state. The
   * current placeholder button ignores this; it's accepted now so the
   * server page doesn't need a follow-up change.
   */
  autoOpenAddModal?: boolean;
}

export function ConnectorList({ connectors }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function toggleStatus(c: ClientConnector) {
    const nextStatus = c.status === 'active' ? 'disabled' : 'active';
    setPendingId(c.id);
    try {
      const res = await fetch(`/api/admin/connectors/${c.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error('[connectors] toggle failed', err);
      alert('Failed to update connector status.');
    } finally {
      setPendingId(null);
    }
  }

  async function disconnect(c: ClientConnector) {
    if (!confirm(`Disconnect "${c.name}"?`)) return;
    setPendingId(c.id);
    try {
      const res = await fetch(`/api/admin/connectors/${c.id}/disconnect`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error('[connectors] disconnect failed', err);
      alert('Failed to disconnect.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => alert('Add dialog lands in Task 16')}>
          + Add connector
        </Button>
      </div>

      {connectors.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No connectors yet. Add one to let the Platform Agent call external
          tools.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Auth</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {connectors.map((c) => {
                const busy = pendingId === c.id || isPending;
                const entry = c.catalogId ? getCatalogEntry(c.catalogId) : null;
                return (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        {entry ? (
                          <Image
                            src={entry.iconUrl}
                            alt=""
                            width={18}
                            height={18}
                          />
                        ) : (
                          <Plug size={16} aria-hidden="true" />
                        )}
                        <span>{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.authType === 'oauth'
                        ? 'OAuth'
                        : c.authType === 'bearer'
                          ? 'Bearer'
                          : 'None'}
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleStatus(c)}
                          disabled={
                            busy ||
                            c.status === 'error' ||
                            c.status === 'pending'
                          }
                          title={
                            c.status === 'error'
                              ? 'Reconnect to fix the error first.'
                              : c.status === 'pending'
                                ? 'OAuth flow still in progress.'
                                : undefined
                          }
                        >
                          {c.status === 'active' ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => disconnect(c)}
                          disabled={busy}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ClientConnector['status'] }) {
  if (status === 'active') return <Badge variant="default">Active</Badge>;
  if (status === 'disabled') return <Badge variant="secondary">Disabled</Badge>;
  if (status === 'pending') return <Badge variant="outline">Pending</Badge>;
  return <Badge variant="destructive">Error</Badge>;
}

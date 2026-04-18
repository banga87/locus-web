'use client';

// Details dialog for a single connector. Opened from a row click in
// `ConnectorList`. Surfaces status, metadata, and the two lifecycle
// actions that used to live inline in the list:
//   - Reconnect (OAuth only, or any connector in `error`): POSTs to
//     /api/admin/connectors/:id/oauth/start, opens the returned
//     authorize URL in a popup, and waits for the same
//     `connector-oauth-complete` postMessage the AddConnectorDialog
//     listens for.
//   - Disconnect: POSTs to /api/admin/connectors/:id/disconnect,
//     closes the dialog, and refreshes.
//
// Tool count is intentionally omitted for v1 (no per-connector tool
// introspection endpoint yet — acceptable per plan).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Plug } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getCatalogEntry } from '@/lib/connectors/catalog';

import type { ClientConnector } from './connector-types';

interface Props {
  connector: ClientConnector;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectorDetailsDialog({
  connector,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const entry = connector.catalogId
    ? getCatalogEntry(connector.catalogId)
    : null;
  const [busy, setBusy] = useState(false);

  // Close on successful OAuth popup postMessage. Same-origin check
  // guards against other tabs / extensions posting into our window.
  useEffect(() => {
    if (!open) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { kind?: string; result?: { ok: boolean } };
      if (data?.kind === 'connector-oauth-complete' && data.result?.ok) {
        onOpenChange(false);
        router.refresh();
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, onOpenChange, router]);

  async function reconnect() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/connectors/${connector.id}/oauth/start`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { authorizeUrl: string };
      window.open(
        body.authorizeUrl,
        'connector-oauth',
        'popup,width=560,height=720',
      );
    } catch (err) {
      console.error('[connectors] reconnect failed', err);
      alert(err instanceof Error ? err.message : 'Reconnect failed.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect "${connector.name}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/connectors/${connector.id}/disconnect`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      console.error('[connectors] disconnect failed', err);
      alert(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setBusy(false);
    }
  }

  const canReconnect = connector.authType === 'oauth';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {entry ? (
              <Image src={entry.iconUrl} alt="" width={20} height={20} />
            ) : (
              <Plug size={18} aria-hidden="true" />
            )}
            <span>{connector.name}</span>
            <StatusBadge status={connector.status} />
          </DialogTitle>
        </DialogHeader>

        <dl className="space-y-2 text-sm">
          <Row label="Server URL">
            <code className="break-all font-mono text-xs">
              {connector.serverUrl}
            </code>
          </Row>
          <Row label="Auth">
            {connector.authType === 'oauth'
              ? 'OAuth'
              : connector.authType === 'bearer'
                ? 'Bearer token'
                : 'None'}
          </Row>
          {connector.catalogId && (
            <Row label="Catalog entry">{connector.catalogId}</Row>
          )}
          <Row label="Created">
            {new Date(connector.createdAt).toLocaleString()}
          </Row>
          <Row label="Last used">
            {connector.lastUsedAt
              ? new Date(connector.lastUsedAt).toLocaleString()
              : '—'}
          </Row>
        </dl>

        {connector.status === 'error' && connector.lastErrorMessage && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">Error</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {connector.lastErrorMessage}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {canReconnect && (
            <Button variant="outline" onClick={reconnect} disabled={busy}>
              Reconnect
            </Button>
          )}
          <Button variant="destructive" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: ClientConnector['status'] }) {
  if (status === 'active') return <Badge variant="default">Active</Badge>;
  if (status === 'disabled') return <Badge variant="secondary">Disabled</Badge>;
  if (status === 'pending') return <Badge variant="outline">Pending</Badge>;
  return <Badge variant="destructive">Error</Badge>;
}

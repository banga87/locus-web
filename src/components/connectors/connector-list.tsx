'use client';

// Connector list — one row per configured connector. Rows are the
// clickable surface: they open `ConnectorDetailsDialog` with the full
// metadata and the Disconnect / Reconnect actions. Inline
// Enable/Disable + Disconnect buttons from earlier iterations moved
// into the details dialog; the list is now a clean icon-row layout.

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Plug } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { getCatalogEntry } from '@/lib/connectors/catalog';

import { AddConnectorDialog } from './add-connector-dialog';
import { ConnectorDetailsDialog } from './connector-details-dialog';
import type { ClientConnector } from './connector-types';

const ADD_MODAL_DISMISSED_KEY = 'connectors.addModalDismissed';

interface Props {
  connectors: ClientConnector[];
  /**
   * Auto-open the Add dialog when the list is empty (no connectors
   * configured). Once the user dismisses it we record that in
   * sessionStorage so we don't pester them on every navigation.
   */
  autoOpenAddModal?: boolean;
}

export function ConnectorList({ connectors, autoOpenAddModal = false }: Props) {
  const [sessionStickyOpen, setSessionStickyOpen] = useState(false);
  const [selected, setSelected] = useState<ClientConnector | null>(null);

  // Auto-open the Add dialog on empty state, but only if the user
  // hasn't already dismissed it this session.
  useEffect(() => {
    if (
      autoOpenAddModal &&
      typeof window !== 'undefined' &&
      !sessionStorage.getItem(ADD_MODAL_DISMISSED_KEY)
    ) {
      setSessionStickyOpen(true);
    }
  }, [autoOpenAddModal]);

  function handleAddDialogOpenChange(open: boolean) {
    // Only mark dismissed on explicit close (not on open).
    if (!open && autoOpenAddModal && typeof window !== 'undefined') {
      sessionStorage.setItem(ADD_MODAL_DISMISSED_KEY, '1');
    }
    if (!open) setSessionStickyOpen(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddConnectorDialog
          initiallyOpen={sessionStickyOpen}
          onOpenChange={handleAddDialogOpenChange}
        />
      </div>

      {connectors.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No connectors yet. Add one to let the Platform Agent call external
          tools.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {connectors.map((c) => {
            const entry = c.catalogId ? getCatalogEntry(c.catalogId) : null;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(c)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-accent"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    {entry ? (
                      <Image
                        src={entry.iconUrl}
                        alt=""
                        width={20}
                        height={20}
                      />
                    ) : (
                      <Plug size={18} aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.name}</div>
                    {!entry && (
                      <div
                        className="truncate text-xs text-muted-foreground"
                        title={c.serverUrl}
                      >
                        {c.serverUrl}
                      </div>
                    )}
                  </div>
                  <StatusBadge status={c.status} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <ConnectorDetailsDialog
          connector={selected}
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        />
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

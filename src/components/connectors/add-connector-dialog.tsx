'use client';

// Two-state Add dialog for the Connectors page.
//
// View 1 ('browse'): grid of catalog tiles + a "Custom connector" tile.
// View 2 ('details'): either the catalog detail pane (OAuth consent button
//   / bearer-token form) or the inlined `CustomConnectorForm`.
//
// OAuth flow: POST /api/admin/connectors with `{ catalogId }` to create a
// row in `pending` status, receive an `authorizeUrl`, open the provider
// consent in a popup window. The callback route (`/api/admin/connectors/
// oauth/callback`) posts a `{ kind: 'connector-oauth-complete', result }`
// message back to this window via `window.opener.postMessage`. When we
// hear it, we close the dialog and refresh the page.

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Plus, ArrowLeft } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CONNECTOR_CATALOG,
  type ConnectorCatalogEntry,
} from '@/lib/connectors/catalog';

import { ConnectorTile } from './connector-tile';
import { CustomConnectorForm } from './custom-connector-dialog';

type View =
  | { kind: 'browse' }
  | { kind: 'details'; entry: ConnectorCatalogEntry | 'custom' };

interface Props {
  /**
   * If true on mount (or when flipped from false → true), the dialog
   * opens automatically. Used for empty-state auto-open on the
   * Connectors page.
   */
  initiallyOpen?: boolean;
  /**
   * Notifies the parent whenever the dialog open state changes. Lets the
   * Connectors page record a `sessionStorage` dismissal so a closed
   * empty-state dialog doesn't re-open on every navigation.
   */
  onOpenChange?: (open: boolean) => void;
}

export function AddConnectorDialog({ initiallyOpen = false, onOpenChange }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [view, setView] = useState<View>({ kind: 'browse' });

  // Re-open if the prop flips from false → true (e.g. parent mounts after
  // session-restore finishes reading sessionStorage). This is a legit
  // prop-to-state sync: the parent cannot own `open` outright because the
  // user also toggles it via the trigger button and OAuth completion
  // handlers; we're only adopting the "initial" signal on the mount
  // transition.
  useEffect(() => {
    if (initiallyOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-to-state sync, see comment above.
      setOpen(true);
    }
  }, [initiallyOpen]);

  // Listen for the OAuth popup's postMessage. Same-origin check guards
  // against other tabs / extensions.
  useEffect(() => {
    if (!open) return;
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { kind?: string; result?: { ok: boolean } };
      if (data?.kind === 'connector-oauth-complete') {
        if (data.result?.ok) {
          setOpen(false);
          onOpenChange?.(false);
          router.refresh();
        }
        // On failure we keep the dialog open; the details pane can
        // display an error in a future iteration. For now the error
        // surfaces as `status: error` in the list after the user closes.
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, router, onOpenChange]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setView({ kind: 'browse' });
    onOpenChange?.(next);
  }

  async function startOauth(entry: ConnectorCatalogEntry) {
    const res = await fetch('/api/admin/connectors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalogId: entry.id }),
    });
    if (!res.ok) {
      alert('Failed to start connection.');
      return;
    }
    const { next } = (await res.json()) as {
      next: { kind: 'oauth'; authorizeUrl: string } | { kind: 'done' };
    };
    if (next.kind === 'oauth') {
      window.open(
        next.authorizeUrl,
        'connector-oauth',
        'popup,width=560,height=720',
      );
    } else {
      handleOpenChange(false);
      router.refresh();
    }
  }

  async function submitBearer(entry: ConnectorCatalogEntry, bearerToken: string) {
    const res = await fetch('/api/admin/connectors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalogId: entry.id, bearerToken }),
    });
    if (!res.ok) {
      alert('Failed to save bearer token.');
      return;
    }
    handleOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Add connector
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        {view.kind === 'browse' ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a connector</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-3 pt-2">
              {CONNECTOR_CATALOG.map((entry) => (
                <ConnectorTile
                  key={entry.id}
                  entry={entry}
                  onClick={() => setView({ kind: 'details', entry })}
                />
              ))}
              <ConnectorTile
                entry="custom"
                onClick={() => setView({ kind: 'details', entry: 'custom' })}
              />
            </div>
          </>
        ) : view.entry === 'custom' ? (
          <CustomDetails
            onBack={() => setView({ kind: 'browse' })}
            onDone={() => {
              handleOpenChange(false);
              router.refresh();
            }}
          />
        ) : (
          <CatalogDetails
            entry={view.entry}
            onBack={() => setView({ kind: 'browse' })}
            onConnect={() => startOauth(view.entry as ConnectorCatalogEntry)}
            onBearerSubmit={(token) =>
              submitBearer(view.entry as ConnectorCatalogEntry, token)
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BackRow({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back">
        <ArrowLeft className="size-4" />
      </Button>
      <DialogTitle className="text-base">{title}</DialogTitle>
    </div>
  );
}

function CatalogDetails({
  entry,
  onBack,
  onConnect,
  onBearerSubmit,
}: {
  entry: ConnectorCatalogEntry;
  onBack: () => void;
  onConnect: () => void;
  onBearerSubmit: (token: string) => void;
}) {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <>
      <DialogHeader>
        <BackRow onBack={onBack} title={entry.name} />
      </DialogHeader>
      <div className="flex items-start gap-4 pt-2">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
          <Image src={entry.iconUrl} alt="" width={28} height={28} />
        </div>
        <div className="flex-1 space-y-3">
          <p className="text-sm text-muted-foreground">{entry.description}</p>
          {entry.docsUrl && (
            <a
              href={entry.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-primary underline underline-offset-2"
            >
              Provider docs
            </a>
          )}
          <div className="pt-1">
            <div className="text-xs text-muted-foreground">
              Auth:{' '}
              {entry.authMode === 'oauth-dcr'
                ? 'OAuth (opens provider consent)'
                : 'API key'}
            </div>
          </div>

          {entry.authMode === 'oauth-dcr' ? (
            <div className="flex justify-end pt-2">
              <Button onClick={onConnect}>Connect</Button>
            </div>
          ) : (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!token.trim()) return;
                setSubmitting(true);
                try {
                  await onBearerSubmit(token.trim());
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <Label htmlFor="bearer">API key</Label>
              <Input
                id="bearer"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
              />
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={submitting || !token.trim()}>
                  {submitting ? 'Connecting…' : 'Connect'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

function CustomDetails({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <BackRow onBack={onBack} title="Custom connector" />
      </DialogHeader>
      <CustomConnectorForm mode="create" onDone={onDone} onCancel={onBack} />
    </>
  );
}

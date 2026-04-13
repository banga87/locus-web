'use client';

// Add / edit dialog for an MCP connection.
//
// Two modes:
//   - `mode="create"` renders a "+ Add connection" trigger button.
//   - `mode="edit"` renders a small "Edit" button beside a row.
//
// On submit we POST (create) or PATCH (edit) the backing API and
// surface the test result inline. When the server reports `test.ok:
// true` we close; on failure we leave the dialog open with the error
// message displayed so the user can correct the URL or token without
// losing context.
//
// Note on auth type transitions: switching from `bearer` to `none`
// clears the stored credential by sending `bearerToken: null`.
// Switching from `none` to `bearer` requires the user to enter a token.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlusIcon, PencilIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { ClientMcpConnection } from './mcp-connection-types';

type Mode = 'create' | 'edit';
type AuthType = 'none' | 'bearer';

interface Props {
  mode: Mode;
  connection?: ClientMcpConnection;
}

interface ApiTestResult {
  ok: boolean;
  toolCount?: number;
  error?: string;
}

export function McpConnectionDialog({ mode, connection }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Form state. In edit mode we seed from `connection`; in create mode
  // we start blank.
  const initial = useMemo(
    () => ({
      name: connection?.name ?? '',
      serverUrl: connection?.serverUrl ?? '',
      authType: (connection?.authType ?? 'none') as AuthType,
      bearerToken: '', // never pre-filled — editing leaves token alone unless the user types
    }),
    [connection],
  );

  const [name, setName] = useState(initial.name);
  const [serverUrl, setServerUrl] = useState(initial.serverUrl);
  const [authType, setAuthType] = useState<AuthType>(initial.authType);
  const [bearerToken, setBearerToken] = useState(initial.bearerToken);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ApiTestResult | null>(null);

  function reset() {
    setName(initial.name);
    setServerUrl(initial.serverUrl);
    setAuthType(initial.authType);
    setBearerToken('');
    setError(null);
    setTestResult(null);
    setSubmitting(false);
  }

  function onOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedUrl = serverUrl.trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    if (!trimmedUrl) {
      setError('Server URL is required.');
      return;
    }
    if (authType === 'bearer') {
      // In create mode the token is required; in edit mode we only
      // require it when transitioning from `none` → `bearer`.
      const existingHasCredential = connection?.hasCredential ?? false;
      const previouslyBearer = initial.authType === 'bearer';
      const needsToken = mode === 'create' || !previouslyBearer || !existingHasCredential;
      if (needsToken && !bearerToken.trim()) {
        setError('Bearer token is required.');
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setTestResult(null);

    try {
      const body: Record<string, unknown> = {
        name: trimmedName,
        serverUrl: trimmedUrl,
        authType,
      };

      if (authType === 'bearer' && bearerToken.trim().length > 0) {
        body.bearerToken = bearerToken.trim();
      } else if (mode === 'edit' && authType === 'none') {
        // Clear the stored credential on a bearer → none transition.
        body.bearerToken = null;
      }

      const url =
        mode === 'create'
          ? '/api/admin/mcp-connections'
          : `/api/admin/mcp-connections/${connection!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? `HTTP ${res.status}`);
      }

      const payload = (await res.json()) as { test?: ApiTestResult | null };
      const test = payload.test ?? null;
      setTestResult(test);

      if (!test || test.ok) {
        router.refresh();
        setOpen(false);
        reset();
      }
      // On test failure we leave the dialog open; the user can fix and retry.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const triggerButton =
    mode === 'create' ? (
      <Button>
        <PlusIcon className="size-4" />
        Add connection
      </Button>
    ) : (
      <Button variant="outline" size="sm">
        <PencilIcon className="size-3.5" />
        Edit
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={triggerButton} />
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>
              {mode === 'create' ? 'Add MCP connection' : 'Edit connection'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'Point the Platform Agent at an external MCP server to expose its tools.'
                : 'Update the connection. The agent picks up changes on the next chat turn.'}
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Gmail"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-server-url">Server URL</Label>
              <Input
                id="mcp-server-url"
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://mcp.example.com/sse"
              />
              <p className="text-xs text-muted-foreground">
                The streamable-HTTP endpoint of the external MCP server.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Auth type</Label>
              <Select
                value={authType}
                onValueChange={(v) => setAuthType(v as AuthType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer token</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {authType === 'bearer' && (
              <div className="space-y-2">
                <Label htmlFor="mcp-bearer">
                  Bearer token
                  {mode === 'edit' && connection?.hasCredential && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      (leave blank to keep the existing token)
                    </span>
                  )}
                </Label>
                <Input
                  id="mcp-bearer"
                  type="password"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Stored encrypted. Sent as{' '}
                  <code className="font-mono">Authorization: Bearer ...</code>.
                </p>
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            {testResult && !testResult.ok && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">Connection test failed</p>
                <p className="mt-1 text-muted-foreground">{testResult.error}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  The connection has been saved with <code>status: error</code>.
                  Fix the URL or token above and retry.
                </p>
              </div>
            )}

            {testResult && testResult.ok && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">Connected.</p>
                <p className="mt-1 text-muted-foreground">
                  Discovered {testResult.toolCount ?? 0} tool
                  {testResult.toolCount === 1 ? '' : 's'}.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? mode === 'create'
                  ? 'Connecting…'
                  : 'Saving…'
                : mode === 'create'
                ? 'Add and test'
                : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

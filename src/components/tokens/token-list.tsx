'use client';

// Table of existing agent access tokens. Server passes the rows in; this
// component only owns the "revoke" interaction — which hits DELETE and
// then refreshes the server component to drop the row.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  status: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

interface Props {
  tokens: TokenRow[];
}

export function TokenList({ tokens }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function revoke(id: string) {
    if (!confirm('Revoke this token? Agents using it will stop working immediately.')) return;
    setPendingId(id);
    try {
      const res = await fetch(`/api/admin/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error('[tokens] revoke failed', err);
      alert('Failed to revoke token.');
    } finally {
      setPendingId(null);
    }
  }

  if (tokens.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No agent tokens yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Prefix</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Created</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => {
            const active = t.status === 'active' && !t.revokedAt;
            return (
              <tr key={t.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {t.prefix}…
                </td>
                <td className="px-4 py-3">
                  <Badge variant={active ? 'default' : 'secondary'}>
                    {active ? 'active' : t.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {active && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => revoke(t.id)}
                      disabled={pendingId === t.id || isPending}
                    >
                      {pendingId === t.id ? 'Revoking…' : 'Revoke'}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

'use client';

// OutputCard — shown at the bottom of the run view when the run has
// completed and produced one or more output documents.
//
// Relocated from src/components/workflows/output-card.tsx during the
// skill/workflow unification. No behavioural changes.
//
// Client component: the set of output docs is only known after
// `run_complete` arrives via Realtime, so rendering has to happen from
// client-side hook state, not from the page's server-rendered snapshot.
// Titles are fetched via a batched POST to /api/brain/documents/titles.
//
// When documentIds is empty we render nothing — this lets the caller
// render <OutputCard> unconditionally when it has the ID list, and the
// component handles the "no output" case itself.

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

interface DocMeta {
  id: string;
  title: string;
  slug: string;
}

interface OutputCardProps {
  documentIds: string[];
}

export function OutputCard({ documentIds }: OutputCardProps) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);

  // Join the IDs into a stable dep key so React only re-runs the effect
  // when the set actually changes (not on every parent render where
  // `documentIds` is a fresh array).
  const idsKey = documentIds.join(',');

  useEffect(() => {
    if (documentIds.length === 0) {
      setDocs([]);
      return;
    }
    let cancelled = false;
    setDocs(null);
    fetch('/api/brain/documents/titles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: documentIds }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json: { success: boolean; data?: { docs: DocMeta[] } }) => {
        if (cancelled) return;
        setDocs(json?.data?.docs ?? []);
      })
      .catch(() => {
        if (!cancelled) setDocs([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  if (documentIds.length === 0) return null;

  // Loading placeholder — keeps the card visible so the layout doesn't
  // jump once titles resolve. Same width/look as the populated state.
  if (docs === null) {
    return (
      <div
        id="output"
        className="rounded-lg border border-border bg-secondary/40 p-4"
      >
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Output documents
        </p>
        <div
          className="h-6 animate-pulse rounded bg-muted/60"
          aria-label="Loading output documents"
        />
      </div>
    );
  }

  // After a resolved fetch that returned no docs (all IDs cross-tenant,
  // deleted, or the request failed and we fell through to []), render
  // nothing rather than a card with an empty list. The banner's "View
  // output" link won't appear in that case because the caller only renders
  // <OutputCard> when the run has outputDocumentIds.
  if (docs.length === 0) return null;

  // Preserve the original order from documentIds so the list matches the
  // order the runner recorded (e.g. first-created first).
  const idIndex = new Map(documentIds.map((id, i) => [id, i]));
  const sorted = [...docs].sort(
    (a, b) => (idIndex.get(a.id) ?? 0) - (idIndex.get(b.id) ?? 0),
  );

  return (
    <div
      id="output"
      className="rounded-lg border border-border bg-secondary/40 p-4"
    >
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Output documents
      </p>
      <ul className="space-y-1">
        {sorted.map((doc) => (
          <li key={doc.id}>
            <Link
              href={`/brain/${doc.id}`}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                'text-ink transition-colors hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <DocIcon />
              <span className="truncate">{doc.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DocIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      className="shrink-0 text-muted-foreground"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

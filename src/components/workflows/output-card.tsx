// OutputCard — shown at the bottom of the run view when the run has
// completed and produced one or more output documents.
//
// Each doc is rendered as a clickable row linking to /brain/[id].
// Server-side: we fetch minimal doc metadata (title) for the IDs.
// This is a server component — it does the DB fetch directly.

import Link from 'next/link';
import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { cn } from '@/lib/utils';

interface OutputCardProps {
  outputDocumentIds: string[];
}

export async function OutputCard({ outputDocumentIds }: OutputCardProps) {
  if (outputDocumentIds.length === 0) return null;

  // Batch-fetch titles for all output doc IDs.
  const docs = await db
    .select({ id: documents.id, title: documents.title, slug: documents.slug })
    .from(documents)
    .where(inArray(documents.id, outputDocumentIds));

  if (docs.length === 0) return null;

  // Sort to match the order in outputDocumentIds (DB returns in arbitrary order).
  const idIndex = new Map(outputDocumentIds.map((id, i) => [id, i]));
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

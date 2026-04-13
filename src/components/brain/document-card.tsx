// Compact card shown in the brain browser. Links to /brain/[id]. Kept as
// a Server Component — no interactivity beyond the wrapping <Link>.

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDistance } from '@/lib/format/time';

export interface DocumentCardData {
  id: string;
  title: string;
  status: 'draft' | 'active' | 'archived';
  confidenceLevel: 'high' | 'medium' | 'low';
  isCore: boolean;
  categoryName: string | null;
  updatedAt: Date;
}

function confidenceClass(c: DocumentCardData['confidenceLevel']): string {
  switch (c) {
    case 'high':
      return 'bg-green-600 text-white';
    case 'medium':
      return 'bg-amber-500 text-white';
    case 'low':
      return 'bg-red-500 text-white';
  }
}

function statusClass(s: DocumentCardData['status']): string {
  switch (s) {
    case 'active':
      return 'bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200';
    case 'archived':
      return 'bg-muted text-muted-foreground';
    case 'draft':
    default:
      return 'bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
  }
}

export function DocumentCard({ doc }: { doc: DocumentCardData }) {
  return (
    <Link
      href={`/brain/${doc.id}`}
      className="group block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="flex-1 text-base font-medium text-foreground group-hover:underline">
          {doc.title}
        </h3>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            confidenceClass(doc.confidenceLevel),
          )}
        >
          {doc.confidenceLevel}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 font-medium',
            statusClass(doc.status),
          )}
        >
          {doc.status}
        </span>
        {doc.isCore && (
          <Badge variant="outline" className="text-[10px] uppercase">
            Core
          </Badge>
        )}
        {doc.categoryName && <span>{doc.categoryName}</span>}
        <span className="ml-auto">{formatDistance(doc.updatedAt)}</span>
      </div>
    </Link>
  );
}

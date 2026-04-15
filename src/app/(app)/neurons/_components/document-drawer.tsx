'use client';

import useSWR from 'swr';
import Link from 'next/link';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

interface Props {
  open: boolean;
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
}

interface DocSummary {
  id: string;
  title: string;
  path: string;
  folderName: string | null;
  confidenceLevel: 'high' | 'medium' | 'low' | null;
  updatedAt: string;
  tokenEstimate: number | null;
}

// GET /api/brain/documents/[id] returns { success: true, data: DocSummary }
async function fetchDoc(url: string): Promise<DocSummary> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('summary_failed');
  const json = await res.json();
  return json.data as DocSummary;
}

export function DocumentDrawer({ open, documentId, onOpenChange }: Props) {
  const { data, error, isLoading } = useSWR<DocSummary>(
    open && documentId ? `/api/brain/documents/${documentId}` : null,
    fetchDoc,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{data?.title ?? 'Document'}</SheetTitle>
        </SheetHeader>
        {isLoading && <p>Loading…</p>}
        {error && <p>Couldn&apos;t load this document.</p>}
        {data && (
          <dl>
            <dt>Path</dt>
            <dd>{data.path}</dd>
            <dt>Folder</dt>
            <dd>{data.folderName ?? '—'}</dd>
            <dt>Confidence</dt>
            <dd>{data.confidenceLevel ?? '—'}</dd>
            <dt>Updated</dt>
            <dd>{new Date(data.updatedAt).toLocaleString()}</dd>
            <dt>Tokens</dt>
            <dd>{data.tokenEstimate ?? '—'}</dd>
          </dl>
        )}
        {data && <Link href={`/brain/${data.id}`}>Open document →</Link>}
      </SheetContent>
    </Sheet>
  );
}

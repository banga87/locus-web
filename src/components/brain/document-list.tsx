// Server-rendered list of documents. The "New Document" button is the only
// bit of interactivity, and it just links to /brain/new.

import Link from 'next/link';
import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { DocumentCard, type DocumentCardData } from './document-card';

interface Props {
  documents: DocumentCardData[];
  canCreate: boolean;
  heading: string;
}

export function DocumentList({ documents, canCreate, heading }: Props) {
  return (
    <div className="flex-1 min-w-0">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
        {canCreate && (
          <Button asChild>
            <Link href="/brain/new">
              <PlusIcon className="size-4" />
              New Document
            </Link>
          </Button>
        )}
      </div>

      {documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No documents yet.
          {canCreate && (
            <>
              {' '}
              <Link href="/brain/new" className="underline">
                Create one
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {documents.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}

// Read-only document view. Shows the full markdown, metadata strip, and an
// Edit CTA for Editor+ roles. "View History" is a stub link — the versions
// feature lands in a later task.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { PencilIcon, HistoryIcon } from 'lucide-react';

import { db } from '@/db';
import { categories, documents, users } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DocumentRenderer } from '@/components/brain/document-renderer';
import { cn } from '@/lib/utils';
import { formatDistance } from '@/lib/format/time';

interface PageProps {
  params: Promise<{ documentId: string }>;
}

function confidenceClass(c: 'high' | 'medium' | 'low'): string {
  switch (c) {
    case 'high':
      return 'bg-green-600 text-white';
    case 'medium':
      return 'bg-amber-500 text-white';
    case 'low':
      return 'bg-red-500 text-white';
  }
}

export default async function DocumentViewPage({ params }: PageProps) {
  const { documentId } = await params;
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const brain = await getBrainForCompany(ctx.companyId);

  const [row] = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      status: documents.status,
      confidenceLevel: documents.confidenceLevel,
      isCore: documents.isCore,
      categoryName: categories.name,
      categorySlug: categories.slug,
      ownerName: users.fullName,
      ownerEmail: users.email,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(categories, eq(documents.categoryId, categories.id))
    .leftJoin(users, eq(documents.ownerId, users.id))
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.brainId, brain.id),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return notFound();

  const canEdit = ['owner', 'admin', 'editor'].includes(ctx.role);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      {row.categoryName && (
        <nav className="mb-3 text-sm text-muted-foreground">
          <Link
            href={`/brain?category=${row.categorySlug ?? ''}`}
            className="hover:underline"
          >
            {row.categoryName}
          </Link>
          <span className="mx-2">→</span>
          <span>{row.title}</span>
        </nav>
      )}

      <header className="mb-6 border-b border-border pb-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{row.title}</h1>

          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={`/brain/${row.id}/edit`} />}
              >
                <PencilIcon className="size-3.5" />
                Edit
              </Button>
            )}
            <Button variant="ghost" size="sm" render={<Link href="#" />}>
              <HistoryIcon className="size-3.5" />
              History
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 font-medium',
              confidenceClass(row.confidenceLevel),
            )}
          >
            {row.confidenceLevel}
          </span>
          <span className="inline-flex items-center rounded-full bg-zinc-200 px-2 py-0.5 font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
            {row.status}
          </span>
          {row.isCore && (
            <Badge variant="outline" className="text-[10px] uppercase">
              Core
            </Badge>
          )}
          {row.ownerName && <span>Owner: {row.ownerName}</span>}
          <span className="ml-auto">
            Last updated {formatDistance(row.updatedAt)}
          </span>
        </div>
      </header>

      <DocumentRenderer markdown={row.content} />
    </div>
  );
}

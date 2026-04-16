// Read-only document view. Renders a brain document in the editorial
// "article" layout (topbar crumbs, eyebrow/title/deck, meta strip, body).
// Editor+ roles get an Edit action in the topbar; "View History" is a stub
// pending the versions feature in a later task.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { PencilIcon } from 'lucide-react';

import { db } from '@/db';
import { documents, folders, users } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { DocumentRenderer } from '@/components/brain/document-renderer';
import { ArticleView } from '@/components/brain/article-view';
import { formatDistance } from '@/lib/format/time';
import { getFreshness } from '@/lib/brain/freshness';

interface PageProps {
  params: Promise<{ documentId: string }>;
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
      summary: documents.summary,
      status: documents.status,
      confidenceLevel: documents.confidenceLevel,
      isCore: documents.isCore,
      folderName: folders.name,
      folderSlug: folders.slug,
      ownerName: users.fullName,
      ownerEmail: users.email,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(folders, eq(documents.folderId, folders.id))
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

  // Eyebrow — folder name plus a Core marker when the doc anchors the brain.
  const eyebrow = row.folderName
    ? row.isCore
      ? `${row.folderName} · Core`
      : row.folderName
    : row.isCore
      ? 'Core'
      : '';

  // Breadcrumb — one folder hop plus current title. Full parent-chain walk
  // is deferred; a later task can recurse through folders.parentId.
  const breadcrumb: Array<{ label: string; href?: string }> = [
    { label: 'Brain', href: '/brain' },
  ];
  if (row.folderName) {
    breadcrumb.push({
      label: row.folderName,
      href: `/brain#${row.folderSlug ?? ''}`,
    });
  }
  breadcrumb.push({ label: row.title });

  // updatedAt is a Date from the timestamp column; freshness wants an ISO
  // string, formatDistance accepts either — keep the Date for the latter.
  const updatedAtIso = row.updatedAt.toISOString();
  const freshness = getFreshness(updatedAtIso, row.confidenceLevel, new Date());

  // users.fullName is nullable; fall back to email, then to a placeholder.
  const author = row.ownerName ?? row.ownerEmail ?? 'Unknown';

  return (
    <ArticleView
      eyebrow={eyebrow}
      title={row.title}
      deck={row.summary}
      breadcrumb={breadcrumb}
      meta={{
        status: row.status,
        confidence: row.confidenceLevel,
        updatedAt: formatDistance(row.updatedAt),
        updatedFreshness: freshness,
        author,
      }}
      actions={
        canEdit ? (
          <Link
            href={`/brain/${row.id}/edit`}
            className="icon-btn"
            title="Edit"
            aria-label="Edit document"
          >
            <PencilIcon className="size-4" />
          </Link>
        ) : null
      }
    >
      <DocumentRenderer markdown={row.content} />
    </ArticleView>
  );
}

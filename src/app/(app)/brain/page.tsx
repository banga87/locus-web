// Brain browser. Two-column layout: folder sidebar (left, filters), docs
// list (right). Filter comes via the `?folder=<slug>` query param so the
// URL is shareable/bookmarkable.
//
// Task 11 will replace this with the Brain home view. For now the page
// still renders via the Task-9 `<CategorySidebar>` component (rename
// pending) but all DB references use the post-rename schema.

import { notFound } from 'next/navigation';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents, folders } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { CategorySidebar } from '@/components/brain/category-sidebar';
import { DocumentList } from '@/components/brain/document-list';

interface PageProps {
  searchParams: Promise<{ folder?: string }>;
}

export default async function BrainPage({ searchParams }: PageProps) {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const params = await searchParams;
  const activeSlug = params.folder ?? '';

  const brain = await getBrainForCompany(ctx.companyId);

  const folderRows = await db
    .select({
      id: folders.id,
      slug: folders.slug,
      name: folders.name,
      documentCount: folders.documentCount,
    })
    .from(folders)
    .where(eq(folders.brainId, brain.id))
    .orderBy(asc(folders.sortOrder), asc(folders.name));

  const selectedFolder = activeSlug
    ? folderRows.find((f) => f.slug === activeSlug)
    : undefined;

  // Filter to user-authored docs: scaffolding/skills/agent-definitions
  // carry a non-null `type` and must not appear in the brain browser.
  const conds = [
    eq(documents.brainId, brain.id),
    isNull(documents.deletedAt),
    isNull(documents.type),
  ];
  if (selectedFolder) conds.push(eq(documents.folderId, selectedFolder.id));

  const docRows = await db
    .select({
      id: documents.id,
      title: documents.title,
      status: documents.status,
      confidenceLevel: documents.confidenceLevel,
      isCore: documents.isCore,
      categoryName: folders.name,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(folders, eq(documents.folderId, folders.id))
    .where(and(...conds))
    .orderBy(desc(documents.isCore), desc(documents.updatedAt));

  const canCreate = ['owner', 'admin', 'editor'].includes(ctx.role);

  const totalCount = folderRows.reduce((s, f) => s + f.documentCount, 0);
  const heading = selectedFolder ? selectedFolder.name : 'All documents';

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex gap-8">
        <CategorySidebar categories={folderRows} totalCount={totalCount} />
        <DocumentList
          documents={docRows}
          canCreate={canCreate}
          heading={heading}
        />
      </div>
    </div>
  );
}

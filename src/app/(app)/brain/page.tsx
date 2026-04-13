// Brain browser. Two-column layout: category sidebar (left, filters), docs
// list (right). Filter comes via the `?category=<slug>` query param so the
// URL is shareable/bookmarkable.

import { notFound } from 'next/navigation';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { categories, documents } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { CategorySidebar } from '@/components/brain/category-sidebar';
import { DocumentList } from '@/components/brain/document-list';

interface PageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function BrainPage({ searchParams }: PageProps) {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const params = await searchParams;
  const activeSlug = params.category ?? '';

  const brain = await getBrainForCompany(ctx.companyId);

  const catRows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      documentCount: categories.documentCount,
    })
    .from(categories)
    .where(eq(categories.brainId, brain.id))
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const selectedCategory = activeSlug
    ? catRows.find((c) => c.slug === activeSlug)
    : undefined;

  const conds = [eq(documents.brainId, brain.id), isNull(documents.deletedAt)];
  if (selectedCategory) conds.push(eq(documents.categoryId, selectedCategory.id));

  const docRows = await db
    .select({
      id: documents.id,
      title: documents.title,
      status: documents.status,
      confidenceLevel: documents.confidenceLevel,
      isCore: documents.isCore,
      categoryName: categories.name,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .leftJoin(categories, eq(documents.categoryId, categories.id))
    .where(and(...conds))
    .orderBy(desc(documents.isCore), desc(documents.updatedAt));

  const canCreate = ['owner', 'admin', 'editor'].includes(ctx.role);

  const totalCount = catRows.reduce((s, c) => s + c.documentCount, 0);
  const heading = selectedCategory ? selectedCategory.name : 'All documents';

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex gap-8">
        <CategorySidebar categories={catRows} totalCount={totalCount} />
        <DocumentList
          documents={docRows}
          canCreate={canCreate}
          heading={heading}
        />
      </div>
    </div>
  );
}

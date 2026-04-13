// New document page. Server Component wrapper so we can load categories
// from the DB once, synchronously, instead of fetching from the client.

import { notFound } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { categories } from '@/db/schema';
import { requireAuth, requireRole } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getBrainForCompany } from '@/lib/brain/queries';
import { NewDocumentForm } from '@/components/brain/new-document-form';

export default async function NewDocumentPage() {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  try {
    requireRole(ctx, 'editor');
  } catch (e) {
    if (e instanceof ApiAuthError) return notFound();
    throw e;
  }

  const brain = await getBrainForCompany(ctx.companyId);

  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.brainId, brain.id))
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  return <NewDocumentForm categories={cats} />;
}

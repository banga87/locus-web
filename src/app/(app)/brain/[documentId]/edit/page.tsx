// Document editor. Server-fetches the document + owner list, then hands off
// to the <DocumentEditor> client component which owns all interactivity.

import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents, users } from '@/db/schema';
import { requireAuth, requireRole } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getBrainForCompany } from '@/lib/brain/queries';
import { DocumentEditor } from '@/components/brain/document-editor';

interface PageProps {
  params: Promise<{ documentId: string }>;
}

export default async function DocumentEditPage({ params }: PageProps) {
  const { documentId } = await params;
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  // Editor+ required. Viewers shouldn't even see the /edit URL; return 404
  // rather than 403 to avoid confirming the document exists.
  try {
    requireRole(ctx, 'editor');
  } catch (e) {
    if (e instanceof ApiAuthError) return notFound();
    throw e;
  }

  const brain = await getBrainForCompany(ctx.companyId);

  const [doc] = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      status: documents.status,
      confidenceLevel: documents.confidenceLevel,
      ownerId: documents.ownerId,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.brainId, brain.id),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!doc) return notFound();

  // Pre-MVP: one user per company. The owner dropdown only lists the
  // caller. Phase 1 will widen this to all active members of the company.
  const [self] = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);

  const owners = self
    ? [{ id: self.id, label: self.fullName || self.email }]
    : [];

  return <DocumentEditor document={doc} owners={owners} />;
}

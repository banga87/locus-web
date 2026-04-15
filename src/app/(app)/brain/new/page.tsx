// New document page. Server Component wrapper so we can load the folder
// tree once, synchronously, instead of fetching from the client.
//
// Task 9: switched from the flat `categories` list to the full nested
// folder tree so the form's destination picker can render indented items
// mirroring the sidebar. Accepts an optional `?folderId=` query param so
// the sidebar's per-folder "New doc" action can preselect the folder.

import { notFound } from 'next/navigation';

import { requireAuth, requireRole } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getBrainForCompany } from '@/lib/brain/queries';
import { getFolderTree } from '@/lib/brain/folders';
import { NewDocumentForm } from '@/components/brain/new-document-form';

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ folderId?: string }>;
}) {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  try {
    requireRole(ctx, 'editor');
  } catch (e) {
    if (e instanceof ApiAuthError) return notFound();
    throw e;
  }

  const brain = await getBrainForCompany(ctx.companyId);
  const tree = await getFolderTree({ brainId: brain.id });
  const { folderId: defaultFolderId } = await searchParams;

  return (
    <NewDocumentForm folders={tree} defaultFolderId={defaultFolderId ?? null} />
  );
}

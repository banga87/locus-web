// New workflow page — server wrapper that loads the folder tree, then
// delegates to the <NewWorkflowForm> client component.
//
// Mirrors the pattern in src/app/(app)/brain/new/page.tsx.

import { notFound } from 'next/navigation';

import { requireAuth, requireRole } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getBrainForCompany } from '@/lib/brain/queries';
import { getFolderTree } from '@/lib/brain/folders';
import { NewWorkflowForm } from '@/components/workflows/new-workflow-form';

export default async function NewWorkflowPage() {
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

  return <NewWorkflowForm folders={tree} />;
}

// Server Actions for the brain UI's folder tree + document operations.
//
// Thin wrappers over `@/lib/brain/folders` that resolve auth (caller's
// company + brain) and call `revalidatePath('/brain', 'layout')` so the
// sidebar + document list re-render after a mutation. The lib does the
// actual DB work and triggers manifest regeneration.
//
// Role policy mirrors the folders REST route — editor+ for all
// mutations. togglePin could plausibly be relaxed to viewer, but keeping
// editor+ matches the existing pattern and avoids a separate role gate
// for one verb.

'use server';

import { revalidatePath } from 'next/cache';

import { requireAuth, requireRole } from '@/lib/api/auth';
import * as folders from '@/lib/brain/folders';
import { getBrainForCompany } from '@/lib/brain/queries';

async function ctxWithBrain(): Promise<{
  companyId: string;
  brainId: string;
}> {
  const ctx = await requireAuth();
  requireRole(ctx, 'editor');
  if (!ctx.companyId) {
    throw new Error('No company associated with this account.');
  }
  const brain = await getBrainForCompany(ctx.companyId);
  return { companyId: ctx.companyId, brainId: brain.id };
}

export async function createFolderAction(input: {
  parentId: string | null;
  name: string;
}): Promise<{ id: string }> {
  const { companyId, brainId } = await ctxWithBrain();
  const result = await folders.createFolder({ companyId, brainId, ...input });
  revalidatePath('/brain', 'layout');
  return result;
}

export async function renameFolderAction(
  folderId: string,
  name: string,
): Promise<void> {
  const { companyId, brainId } = await ctxWithBrain();
  await folders.renameFolder({ companyId, brainId, folderId, name });
  revalidatePath('/brain', 'layout');
}

export async function deleteFolderAction(folderId: string): Promise<void> {
  const { companyId, brainId } = await ctxWithBrain();
  await folders.deleteFolder({ companyId, brainId, folderId });
  revalidatePath('/brain', 'layout');
}

export async function moveDocumentAction(
  documentId: string,
  folderId: string,
): Promise<void> {
  const { companyId, brainId } = await ctxWithBrain();
  await folders.moveDocument({ companyId, brainId, documentId, folderId });
  revalidatePath('/brain', 'layout');
}

export async function togglePinAction(
  documentId: string,
): Promise<{ isPinned: boolean }> {
  const { companyId, brainId } = await ctxWithBrain();
  const result = await folders.togglePin({ companyId, brainId, documentId });
  revalidatePath('/brain', 'layout');
  return result;
}

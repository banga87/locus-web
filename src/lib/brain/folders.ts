// Folder-CRUD + document-move + pin lib for the brain UI.
//
// Pure data-layer: no Next.js imports (no `next/headers`, no
// `revalidatePath`). Mutations accept `{ companyId, brainId, ... }` and
// trust the caller to have authenticated; defense-in-depth checks
// (`folder belongs to companyId?`) live here, but auth itself is the
// route/server-action's job. Pattern mirrors `src/lib/brain/save.ts`.
//
// Error contract: thrown errors use stable, lowercase, prefix-style
// messages so UI callers can branch by string match without depending
// on a specific error class hierarchy. Current vocabulary:
//
//   - 'slug conflict: ...'        — sibling slug uniqueness violated
//   - 'folder has children'       — delete blocked: subfolders exist
//   - 'folder has documents'      — delete blocked: live docs exist
//   - 'folder not found'          — folderId missing or wrong company
//   - 'document not found'        — documentId missing or wrong company
//
// Callers can match on the leading phrase (e.g. /^folder has /) for
// branching. Exact wording may include trailing detail; the prefix is
// the API.

import { and, eq, isNull, ne } from 'drizzle-orm';

import { db } from '@/db';
import { documents, folders } from '@/db/schema';

import {
  buildFolderTree,
  regenerateManifest,
  type ManifestFolder,
} from './manifest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lowercase, replace any run of non-alphanumeric characters with a single
 * dash, trim leading/trailing dashes. Designed for English brain names —
 * unicode normalization is out of scope (we lose accents). Empty input or
 * input with no alphanumerics returns an empty string; callers should
 * guard for that.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Throw if the proposed slug collides with another sibling under the same
 * parent. The DB enforces this via two partial unique indexes; we mirror
 * the check here for a friendlier error and to fail fast before the
 * mutation is attempted.
 *
 * `excludeFolderId` lets renames re-use their own slug (a rename whose
 * resulting slug equals the current one is a no-op, not a conflict).
 */
async function assertSlugAvailable(
  brainId: string,
  parentId: string | null,
  slug: string,
  excludeFolderId?: string,
): Promise<void> {
  const conditions = [eq(folders.brainId, brainId), eq(folders.slug, slug)];
  if (parentId === null) {
    conditions.push(isNull(folders.parentId));
  } else {
    conditions.push(eq(folders.parentId, parentId));
  }
  if (excludeFolderId) {
    conditions.push(ne(folders.id, excludeFolderId));
  }

  const [dupe] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(...conditions))
    .limit(1);

  if (dupe) {
    throw new Error(`slug conflict: ${slug} already exists under this parent`);
  }
}

/**
 * Load a folder row, asserting it belongs to the given company. Throws
 * 'folder not found' if missing or owned by another company.
 */
async function loadFolderForCompany(
  folderId: string,
  companyId: string,
): Promise<typeof folders.$inferSelect> {
  const [row] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.companyId, companyId)))
    .limit(1);
  if (!row) throw new Error(`folder not found: ${folderId}`);
  return row;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreateFolderInput {
  companyId: string;
  brainId: string;
  parentId: string | null;
  name: string;
}

export async function createFolder(
  input: CreateFolderInput,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new Error('folder name is required');

  const slug = slugify(name);
  if (!slug) throw new Error('folder name must contain alphanumeric characters');

  // Verify parent (if any) belongs to the same brain + company.
  if (input.parentId) {
    const parent = await loadFolderForCompany(input.parentId, input.companyId);
    if (parent.brainId !== input.brainId) {
      throw new Error(`folder not found: ${input.parentId}`);
    }
  }

  await assertSlugAvailable(input.brainId, input.parentId, slug);

  let id: string;
  try {
    const [row] = await db
      .insert(folders)
      .values({
        companyId: input.companyId,
        brainId: input.brainId,
        parentId: input.parentId,
        name,
        slug,
      })
      .returning({ id: folders.id });
    id = row.id;
  } catch (e) {
    // Race against the partial unique index — surface as the same friendly
    // contract as the pre-flight check.
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique|duplicate/i.test(msg)) {
      throw new Error(`slug conflict: ${slug} already exists under this parent`);
    }
    throw e;
  }

  await regenerateManifest(input.brainId);
  return { id };
}

export async function renameFolder(input: {
  companyId: string;
  brainId: string;
  folderId: string;
  name: string;
}): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error('folder name is required');

  const existing = await loadFolderForCompany(input.folderId, input.companyId);
  if (existing.brainId !== input.brainId) {
    throw new Error(`folder not found: ${input.folderId}`);
  }

  const slug = slugify(name);
  if (!slug) throw new Error('folder name must contain alphanumeric characters');

  await assertSlugAvailable(
    input.brainId,
    existing.parentId,
    slug,
    input.folderId,
  );

  // TODO(path-drift): renaming a folder leaves stale `documents.path`
  // values pointing at the old slug. The path is a denormalised
  // `{folder_slug}/{doc_slug}` cached for MCP lookups; refreshing it on
  // rename is out of scope for this task and will be addressed alongside
  // the move/path migration.
  try {
    await db
      .update(folders)
      .set({ name, slug, updatedAt: new Date() })
      .where(eq(folders.id, input.folderId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique|duplicate/i.test(msg)) {
      throw new Error(`slug conflict: ${slug} already exists under this parent`);
    }
    throw e;
  }

  await regenerateManifest(input.brainId);
}

export async function deleteFolder(input: {
  companyId: string;
  brainId: string;
  folderId: string;
}): Promise<void> {
  const existing = await loadFolderForCompany(input.folderId, input.companyId);
  if (existing.brainId !== input.brainId) {
    throw new Error(`folder not found: ${input.folderId}`);
  }

  // Use a transaction to make the children/documents check + delete atomic.
  // Without this, a concurrent insert between the check and the delete
  // could leave us in a violating state (or fail the FK RESTRICT and bubble
  // a less-friendly error). Postgres serialisable isn't required — the
  // FK itself is the ultimate guard.
  await db.transaction(async (tx) => {
    const [childFolder] = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.parentId, input.folderId))
      .limit(1);
    if (childFolder) {
      throw new Error('folder has children');
    }

    const [childDoc] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.folderId, input.folderId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (childDoc) {
      throw new Error('folder has documents');
    }

    await tx.delete(folders).where(eq(folders.id, input.folderId));
  });

  await regenerateManifest(input.brainId);
}

export async function moveDocument(input: {
  companyId: string;
  brainId: string;
  documentId: string;
  folderId: string;
}): Promise<void> {
  // Verify destination folder belongs to this company + brain.
  const dst = await loadFolderForCompany(input.folderId, input.companyId);
  if (dst.brainId !== input.brainId) {
    throw new Error(`folder not found: ${input.folderId}`);
  }

  // Verify document exists and is owned by this company.
  const [doc] = await db
    .select({ id: documents.id, brainId: documents.brainId })
    .from(documents)
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.companyId, input.companyId),
      ),
    )
    .limit(1);
  if (!doc || doc.brainId !== input.brainId) {
    throw new Error(`document not found: ${input.documentId}`);
  }

  // TODO(path-drift): moving a document leaves the denormalised
  // `documents.path` field pointing at the old folder slug. Refreshing
  // it is out of scope for this task; the next document save will
  // re-derive the path.
  await db
    .update(documents)
    .set({ folderId: input.folderId, updatedAt: new Date() })
    .where(eq(documents.id, input.documentId));

  await regenerateManifest(input.brainId);
}

export async function togglePin(input: {
  companyId: string;
  brainId: string;
  documentId: string;
}): Promise<{ isPinned: boolean }> {
  const [doc] = await db
    .select({ isPinned: documents.isPinned, brainId: documents.brainId })
    .from(documents)
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.companyId, input.companyId),
      ),
    )
    .limit(1);
  if (!doc || doc.brainId !== input.brainId) {
    throw new Error(`document not found: ${input.documentId}`);
  }

  const next = !doc.isPinned;
  await db
    .update(documents)
    .set({ isPinned: next, updatedAt: new Date() })
    .where(eq(documents.id, input.documentId));

  // togglePin DOES change manifest contents (`isPinned` is in
  // ManifestDocument and affects the pinned-first sort), so regenerate.
  await regenerateManifest(input.brainId);
  return { isPinned: next };
}

/**
 * Read-only helper returning the same nested shape used by the navigation
 * manifest. Re-using the type keeps the sidebar and the agent in sync —
 * if the manifest contract changes, the sidebar tracks it for free.
 */
export async function getFolderTree(input: {
  brainId: string;
}): Promise<ManifestFolder[]> {
  return buildFolderTree(input.brainId);
}

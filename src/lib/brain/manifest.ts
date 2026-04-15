// Navigation-manifest regeneration.
//
// The manifest is a denormalized snapshot of a brain's folder hierarchy
// + non-deleted, knowledge-typed documents, served to agents via
// get_manifest. We regenerate it on every write path (document
// create/update/delete, folder CRUD, initial seed) rather than streaming
// updates: a brain has ~dozens of docs, so a full rebuild is cheap and
// sidesteps a whole class of drift bugs.
//
// Shape: nested `folders[]` tree built from the per-brain folders table
// via parent_id. Documents whose `type` column is non-null
// (agent-scaffolding, agent-definition, skill) are excluded — those are
// platform internals, not knowledge.
//
// No outer transaction on the flip-current + insert: if the UPDATE
// succeeds and the INSERT fails, the next successful regeneration
// recovers (it flips any stragglers to is_current=false before inserting).
// A transient "zero current manifests" window is acceptable because reads
// can always fall back to regenerating on demand.

import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import {
  brains,
  documents,
  folders,
  navigationManifests,
} from '@/db/schema';

export interface ManifestDocument {
  id: string;
  path: string;
  title: string;
  summary: string | null;
  confidenceLevel: 'high' | 'medium' | 'low';
  status: 'draft' | 'active' | 'archived';
  isCore: boolean;
  isPinned: boolean;
  updatedAt: string; // ISO 8601
}

export interface ManifestFolder {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  folders: ManifestFolder[];
  documents: ManifestDocument[];
}

export interface Manifest {
  generatedAt: string;
  folders: ManifestFolder[];
}

/**
 * Build the nested folder/document tree for a brain in the manifest's
 * canonical shape (`ManifestFolder[]`). Factored out so callers that need
 * the same shape without writing a `navigation_manifests` row — sidebar
 * data fetchers, the folders CRUD lib's `getFolderTree` — can reuse it.
 *
 * Includes only live (`deletedAt IS NULL`) knowledge-typed (`type IS NULL`)
 * documents, matching the agent-facing manifest contract.
 */
export async function buildFolderTree(
  brainId: string,
): Promise<ManifestFolder[]> {
  // 1. Fetch all folders for the brain in deterministic order (sortOrder
  //    then name for tie-break).
  const folderRows = await db
    .select()
    .from(folders)
    .where(eq(folders.brainId, brainId))
    .orderBy(folders.sortOrder, folders.name);

  // 2. Fetch all live, knowledge-typed documents for the brain. The
  //    `isNull(documents.type)` filter excludes agent-scaffolding,
  //    agent-definition, and skill rows — those are platform internals
  //    and never appear in the agent-facing manifest.
  const docRows = await db
    .select({
      id: documents.id,
      folderId: documents.folderId,
      path: documents.path,
      title: documents.title,
      summary: documents.summary,
      confidenceLevel: documents.confidenceLevel,
      status: documents.status,
      isCore: documents.isCore,
      isPinned: documents.isPinned,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, brainId),
        isNull(documents.deletedAt),
        isNull(documents.type),
      ),
    )
    .orderBy(desc(documents.isPinned), documents.title);

  // 3. Build the tree. First materialise every folder as a node, then
  //    attach to its parent (or push to roots).
  const byId = new Map<string, ManifestFolder>();
  for (const f of folderRows) {
    byId.set(f.id, {
      id: f.id,
      slug: f.slug,
      name: f.name,
      description: f.description,
      folders: [],
      documents: [],
    });
  }

  const roots: ManifestFolder[] = [];
  for (const f of folderRows) {
    const node = byId.get(f.id)!;
    if (f.parentId === null) {
      roots.push(node);
    } else {
      byId.get(f.parentId)?.folders.push(node);
    }
  }

  // 4. Place each document under its folder. Documents with no folder
  //    (folderId null) are skipped — the manifest is a folder-rooted
  //    view; orphaned docs surface elsewhere in the UI.
  for (const d of docRows) {
    if (!d.folderId) continue;
    const node = byId.get(d.folderId);
    if (!node) continue;
    node.documents.push({
      id: d.id,
      path: d.path,
      title: d.title,
      summary: d.summary,
      confidenceLevel: d.confidenceLevel,
      status: d.status,
      isCore: d.isCore,
      isPinned: d.isPinned,
      updatedAt:
        d.updatedAt instanceof Date
          ? d.updatedAt.toISOString()
          : String(d.updatedAt),
    });
  }

  return roots;
}

export async function regenerateManifest(brainId: string): Promise<void> {
  // Resolve companyId — navigation_manifests.company_id is NOT NULL. The
  // brain row is the source of truth; callers pass only brainId.
  const [brain] = await db
    .select({ companyId: brains.companyId })
    .from(brains)
    .where(eq(brains.id, brainId))
    .limit(1);

  if (!brain) {
    throw new Error(`regenerateManifest: brain ${brainId} not found`);
  }

  const roots = await buildFolderTree(brainId);

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    folders: roots,
  };

  // 5. Flip any existing current manifests off. Scoped to this brain only.
  await db
    .update(navigationManifests)
    .set({ isCurrent: false })
    .where(eq(navigationManifests.brainId, brainId));

  // 6. Insert the new current manifest.
  await db.insert(navigationManifests).values({
    companyId: brain.companyId,
    brainId,
    content: manifest,
    isCurrent: true,
  });
}

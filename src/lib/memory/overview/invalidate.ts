// src/lib/memory/overview/invalidate.ts
//
// Regenerates the `_overview-<folder>` document for a given folder.
// Idempotent: upsert by (brain_id, slug). Content is built from
// generateFolderOverview() over the folder's direct children.
//
// Harness-pure — only imports @/db and drizzle helpers.

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { folders } from '@/db/schema/folders';
import { generateFolderOverview, type OverviewChild } from './generate';
import type { CompactIndex } from '../types';

export interface RegenerateInput {
  companyId: string;
  brainId: string;
  folderPath: string; // top-level folder slug, or 'root' for brain root
}

export async function regenerateFolderOverview(
  input: RegenerateInput,
): Promise<void> {
  const overviewSlug = `_overview-${input.folderPath || 'root'}`;

  // Find the folder row for this path (null for root).
  let folderRow: { id: string } | null = null;
  if (input.folderPath !== 'root') {
    const [row] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(
          eq(folders.brainId, input.brainId),
          eq(folders.slug, input.folderPath),
        ),
      )
      .limit(1);
    folderRow = row ?? null;
  }

  // Load direct children (documents whose folder_id matches).
  // Only user-authored docs (type IS NULL) — exclude overviews, skills,
  // agent-defs, and agent-scaffolding.
  const rawChildren = await db
    .select({
      path: documents.path,
      title: documents.title,
      compactIndex: documents.compactIndex,
    })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, input.brainId),
        folderRow ? eq(documents.folderId, folderRow.id) : isNull(documents.folderId),
        isNull(documents.deletedAt),
        isNull(documents.type),
      ),
    );

  const children: OverviewChild[] = rawChildren.map((r) => ({
    path: r.path,
    title: r.title,
    compact_index: (r.compactIndex as CompactIndex | null) ?? null,
  }));

  // Subfolders list (shallow — don't recurse yet).
  const subfolders = folderRow
    ? await db
        .select({ slug: folders.slug })
        .from(folders)
        .where(eq(folders.parentId, folderRow.id))
    : await db
        .select({ slug: folders.slug })
        .from(folders)
        .where(
          and(eq(folders.brainId, input.brainId), isNull(folders.parentId)),
        );

  const body = generateFolderOverview({
    folderPath: input.folderPath,
    children,
    childFolders: subfolders.map((r) => r.slug),
  });

  // Upsert the overview document.
  const [existing] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.brainId, input.brainId), eq(documents.slug, overviewSlug)),
    )
    .limit(1);

  if (existing) {
    await db
      .update(documents)
      .set({
        content: body,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, existing.id));
  } else {
    await db.insert(documents).values({
      companyId: input.companyId,
      brainId: input.brainId,
      folderId: folderRow?.id ?? null,
      title: `Overview: ${input.folderPath}`,
      slug: overviewSlug,
      path: `${input.folderPath}/${overviewSlug}`,
      content: body,
      type: 'overview',
      metadata: { auto_generated: true },
    });
  }
}

// Integration tests for the folder-CRUD lib (`src/lib/brain/folders.ts`).
//
// Asserts both the DB row state after each mutation AND that the
// navigation-manifest current row reflects the change. Mirrors the
// suffix/teardown convention from `manifest.test.ts` and
// `manifest.fixtures.ts` — nested-folder-safe cleanup (parented folders
// first, then top-level, then brain, then company).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNotNull } from 'drizzle-orm';

// Each mutation triggers a full manifest regeneration, and the DB sits
// behind a Supabase pooler — multi-step tests need more than the default
// 5s ceiling.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

import { db } from '@/db';
import {
  brains,
  companies,
  documents,
  folders as foldersTable,
  navigationManifests,
} from '@/db/schema';

import {
  createFolder,
  deleteFolder,
  getFolderTree,
  moveDocument,
  renameFolder,
  togglePin,
} from '../folders';
import type { Manifest } from '../manifest';

interface Fixtures {
  companyId: string;
  brainId: string;
  emptyCompanyId: string;
  emptyBrainId: string;
  suffix: string;
}

let f: Fixtures;

async function readCurrent(brainId: string): Promise<Manifest> {
  const [row] = await db
    .select({ content: navigationManifests.content })
    .from(navigationManifests)
    .where(
      and(
        eq(navigationManifests.brainId, brainId),
        eq(navigationManifests.isCurrent, true),
      ),
    )
    .limit(1);
  if (!row) throw new Error(`no current manifest for brain ${brainId}`);
  return row.content as Manifest;
}

beforeAll(async () => {
  const suffix = `folders-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Folders Test Co ${suffix}`, slug: `fld-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company.id, name: 'Main Brain', slug: 'main' })
    .returning({ id: brains.id });

  const [emptyCompany] = await db
    .insert(companies)
    .values({ name: `Folders Empty Co ${suffix}`, slug: `fld-empty-${suffix}` })
    .returning({ id: companies.id });

  const [emptyBrain] = await db
    .insert(brains)
    .values({ companyId: emptyCompany.id, name: 'Empty Brain', slug: 'empty' })
    .returning({ id: brains.id });

  f = {
    companyId: company.id,
    brainId: brain.id,
    emptyCompanyId: emptyCompany.id,
    emptyBrainId: emptyBrain.id,
    suffix,
  };
});

afterAll(async () => {
  // folders.parent_id is ON DELETE RESTRICT — drop nested first, then
  // top-level, then brain (cascades documents + manifests), then company.
  for (const brainId of [f.brainId, f.emptyBrainId]) {
    await db
      .delete(foldersTable)
      .where(
        and(
          eq(foldersTable.brainId, brainId),
          isNotNull(foldersTable.parentId),
        ),
      );
    await db.delete(foldersTable).where(eq(foldersTable.brainId, brainId));
    await db.delete(brains).where(eq(brains.id, brainId));
  }
  await db.delete(companies).where(eq(companies.id, f.companyId));
  await db.delete(companies).where(eq(companies.id, f.emptyCompanyId));
});

describe('createFolder', () => {
  it('creates a top-level folder with generated slug from name', async () => {
    const { id } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `Brand & Voice ${f.suffix}-1`,
    });

    const [row] = await db
      .select()
      .from(foldersTable)
      .where(eq(foldersTable.id, id));
    expect(row).toBeDefined();
    expect(row.name).toBe(`Brand & Voice ${f.suffix}-1`);
    expect(row.parentId).toBeNull();
    // Slug is generated from the name: lowercase, non-alphanumerics → '-',
    // collapsed and trimmed.
    expect(row.slug).toMatch(/^brand-voice-folders-\d+-\d+-1$/);
    expect(row.brainId).toBe(f.brainId);
    expect(row.companyId).toBe(f.companyId);
  });

  it('creates a nested folder under a parent', async () => {
    const { id: parentId } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `Parent ${f.suffix}-2`,
    });

    const { id: childId } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId,
      name: `Child ${f.suffix}-2`,
    });

    const [row] = await db
      .select()
      .from(foldersTable)
      .where(eq(foldersTable.id, childId));
    expect(row.parentId).toBe(parentId);
  });

  it('rejects duplicate slug within the same parent', async () => {
    const { id: parentId } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `DupParent ${f.suffix}-3`,
    });

    await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId,
      name: `Same Name ${f.suffix}-3`,
    });

    await expect(
      createFolder({
        companyId: f.companyId,
        brainId: f.brainId,
        parentId,
        name: `Same Name ${f.suffix}-3`,
      }),
    ).rejects.toThrow(/slug conflict/);
  });

  it('allows the same slug under different parents', async () => {
    const { id: parentA } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `ParentA ${f.suffix}-4`,
    });
    const { id: parentB } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `ParentB ${f.suffix}-4`,
    });

    const { id: childA } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: parentA,
      name: 'Shared Name',
    });
    const { id: childB } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: parentB,
      name: 'Shared Name',
    });

    expect(childA).not.toBe(childB);
    const rows = await db
      .select()
      .from(foldersTable)
      .where(eq(foldersTable.brainId, f.brainId));
    const a = rows.find((r) => r.id === childA)!;
    const b = rows.find((r) => r.id === childB)!;
    expect(a.slug).toBe(b.slug);
    expect(a.parentId).not.toBe(b.parentId);
  });

  it('regenerates the manifest', async () => {
    const { id } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `Manifest Refresh ${f.suffix}-5`,
    });

    const m = await readCurrent(f.brainId);
    const found = m.folders.find((node) => node.id === id);
    expect(found).toBeDefined();
  });
});

describe('renameFolder', () => {
  it('updates name and regenerates slug from name', async () => {
    const { id } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `Original ${f.suffix}-rename1`,
    });

    await renameFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      folderId: id,
      name: `Renamed Folder ${f.suffix}-rename1`,
    });

    const [row] = await db
      .select()
      .from(foldersTable)
      .where(eq(foldersTable.id, id));
    expect(row.name).toBe(`Renamed Folder ${f.suffix}-rename1`);
    expect(row.slug).toMatch(/^renamed-folder-folders-\d+-\d+-rename1$/);
  });

  it('regenerates the manifest', async () => {
    const { id } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `Pre Rename ${f.suffix}-rename2`,
    });

    await renameFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      folderId: id,
      name: `Post Rename ${f.suffix}-rename2`,
    });

    const m = await readCurrent(f.brainId);
    const node = m.folders.find((n) => n.id === id)!;
    expect(node.name).toBe(`Post Rename ${f.suffix}-rename2`);
    expect(node.slug).toMatch(/^post-rename-/);
  });
});

describe('deleteFolder', () => {
  it('deletes an empty folder', async () => {
    const { id } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `ToDelete ${f.suffix}-del1`,
    });

    await deleteFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      folderId: id,
    });

    const rows = await db
      .select()
      .from(foldersTable)
      .where(eq(foldersTable.id, id));
    expect(rows).toHaveLength(0);
  });

  it('rejects delete when folder has child folders', async () => {
    const { id: parentId } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `HasChild ${f.suffix}-del2`,
    });
    await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId,
      name: 'A Child',
    });

    await expect(
      deleteFolder({
        companyId: f.companyId,
        brainId: f.brainId,
        folderId: parentId,
      }),
    ).rejects.toThrow(/folder has children/);
  });

  it('rejects delete when folder has documents', async () => {
    const { id } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `HasDocs ${f.suffix}-del3`,
    });

    await db.insert(documents).values({
      companyId: f.companyId,
      brainId: f.brainId,
      folderId: id,
      title: 'A doc',
      slug: `del3-doc-${f.suffix}`,
      path: `del3/del3-doc-${f.suffix}`,
      content: '# X',
      status: 'active',
    });

    await expect(
      deleteFolder({
        companyId: f.companyId,
        brainId: f.brainId,
        folderId: id,
      }),
    ).rejects.toThrow(/folder has documents/);
  });

  it('regenerates the manifest after successful delete', async () => {
    const { id } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `DelManifest ${f.suffix}-del4`,
    });

    await deleteFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      folderId: id,
    });

    const m = await readCurrent(f.brainId);
    expect(m.folders.find((n) => n.id === id)).toBeUndefined();
  });
});

describe('moveDocument', () => {
  it('moves a document to a new folder', async () => {
    const { id: srcFolder } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `MoveSrc ${f.suffix}-mv1`,
    });
    const { id: dstFolder } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `MoveDst ${f.suffix}-mv1`,
    });

    const [doc] = await db
      .insert(documents)
      .values({
        companyId: f.companyId,
        brainId: f.brainId,
        folderId: srcFolder,
        title: 'Moveable',
        slug: `moveable-${f.suffix}`,
        path: `move-src/moveable-${f.suffix}`,
        content: '# x',
        status: 'active',
      })
      .returning({ id: documents.id });

    await moveDocument({
      companyId: f.companyId,
      brainId: f.brainId,
      documentId: doc.id,
      folderId: dstFolder,
    });

    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));
    expect(row.folderId).toBe(dstFolder);
  });

  it('regenerates manifest after move', async () => {
    const { id: srcFolder } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `MvSrc ${f.suffix}-mv2`,
    });
    const { id: dstFolder } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `MvDst ${f.suffix}-mv2`,
    });

    const [doc] = await db
      .insert(documents)
      .values({
        companyId: f.companyId,
        brainId: f.brainId,
        folderId: srcFolder,
        title: 'MoveMe2',
        slug: `mv2-${f.suffix}`,
        path: `mv-src2/mv2-${f.suffix}`,
        content: '# y',
        status: 'active',
      })
      .returning({ id: documents.id });

    await moveDocument({
      companyId: f.companyId,
      brainId: f.brainId,
      documentId: doc.id,
      folderId: dstFolder,
    });

    const m = await readCurrent(f.brainId);
    const dst = m.folders.find((n) => n.id === dstFolder)!;
    expect(dst.documents.find((d) => d.id === doc.id)).toBeDefined();
    const src = m.folders.find((n) => n.id === srcFolder)!;
    expect(src.documents.find((d) => d.id === doc.id)).toBeUndefined();
  });
});

describe('togglePin', () => {
  it('pins an unpinned doc', async () => {
    const { id: folderId } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `Pin ${f.suffix}-pin1`,
    });
    const [doc] = await db
      .insert(documents)
      .values({
        companyId: f.companyId,
        brainId: f.brainId,
        folderId,
        title: 'Pin1',
        slug: `pin1-${f.suffix}`,
        path: `pin1/pin1-${f.suffix}`,
        content: '# z',
        status: 'active',
        isPinned: false,
      })
      .returning({ id: documents.id });

    const result = await togglePin({
      companyId: f.companyId,
      brainId: f.brainId,
      documentId: doc.id,
    });

    expect(result.isPinned).toBe(true);
    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));
    expect(row.isPinned).toBe(true);
  });

  it('unpins a pinned doc', async () => {
    const { id: folderId } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `Pin ${f.suffix}-pin2`,
    });
    const [doc] = await db
      .insert(documents)
      .values({
        companyId: f.companyId,
        brainId: f.brainId,
        folderId,
        title: 'Pin2',
        slug: `pin2-${f.suffix}`,
        path: `pin2/pin2-${f.suffix}`,
        content: '# z',
        status: 'active',
        isPinned: true,
      })
      .returning({ id: documents.id });

    const result = await togglePin({
      companyId: f.companyId,
      brainId: f.brainId,
      documentId: doc.id,
    });

    expect(result.isPinned).toBe(false);
    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));
    expect(row.isPinned).toBe(false);
  });

  it('regenerates the manifest with the new pin state', async () => {
    const { id: folderId } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `Pin ${f.suffix}-pin3`,
    });
    const [doc] = await db
      .insert(documents)
      .values({
        companyId: f.companyId,
        brainId: f.brainId,
        folderId,
        title: 'Pin3',
        slug: `pin3-${f.suffix}`,
        path: `pin3/pin3-${f.suffix}`,
        content: '# z',
        status: 'active',
        isPinned: false,
      })
      .returning({ id: documents.id });

    // Walk folders + subfolders looking for the doc. Keeps the assertion
    // resilient if the tree ever gets reshuffled (nested folder, etc).
    const findInManifest = (m: Manifest, id: string) => {
      const stack = [...m.folders];
      while (stack.length) {
        const node = stack.shift()!;
        const hit = node.documents.find((d) => d.id === id);
        if (hit) return hit;
        stack.push(...node.folders);
      }
      return undefined;
    };

    // The insert above went straight to the DB, so the current manifest
    // hasn't seen the doc yet — force a regen via a no-op first toggle
    // (pin → true), then verify the manifest reflects the pinned state.
    const pinResult = await togglePin({
      companyId: f.companyId,
      brainId: f.brainId,
      documentId: doc.id,
    });
    expect(pinResult.isPinned).toBe(true);
    const afterPin = await readCurrent(f.brainId);
    expect(findInManifest(afterPin, doc.id)?.isPinned).toBe(true);

    // unpin and re-check
    const unpinResult = await togglePin({
      companyId: f.companyId,
      brainId: f.brainId,
      documentId: doc.id,
    });
    expect(unpinResult.isPinned).toBe(false);
    const afterUnpin = await readCurrent(f.brainId);
    expect(findInManifest(afterUnpin, doc.id)?.isPinned).toBe(false);
  });
});

describe('getFolderTree', () => {
  it('returns the full nested tree for a brain', async () => {
    const { id: top } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: null,
      name: `Tree Top ${f.suffix}-tree1`,
    });
    const { id: child } = await createFolder({
      companyId: f.companyId,
      brainId: f.brainId,
      parentId: top,
      name: `Tree Child ${f.suffix}-tree1`,
    });

    const tree = await getFolderTree({ brainId: f.brainId });
    const node = tree.find((n) => n.id === top);
    expect(node).toBeDefined();
    expect(node!.folders.find((n) => n.id === child)).toBeDefined();
  });

  it('returns empty array for a brain with no folders', async () => {
    const tree = await getFolderTree({ brainId: f.emptyBrainId });
    expect(tree).toEqual([]);
  });
});

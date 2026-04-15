'use client';

// Recursive folder/document tree rendered inside <NewSidebar>. The shape
// mirrors the nav manifest (`ManifestFolder[]`); each folder node tracks
// its own open/closed state via `useState` — parents don't coordinate
// children, so "expand all" / "collapse all" would need lifting.
//
// Render order within a folder: documents first, then sub-folders. Matches
// the Fraunces/Forest mockup (`mockups/ui-exploration/fraunces-forest.html`)
// where "Product Overview" and "Feature Catalog" appear before the
// "Terravolt Products" sub-folder under "Product & Service".
//
// Active state is pathname-driven: `usePathname()` → a document link is
// active if the path is `/brain/<id>` or begins with `/brain/<id>/`. The
// CSS styles both `.node.selected` and `.node[data-active="true"]`
// identically; we use the data attribute so tests can assert on it
// without inspecting class strings.
//
// Task 9: folder/doc rows carry a ⋮ context-menu button that opens a
// shadcn DropdownMenu. Menu items dispatch to a single dialog slot
// lifted to `<BrainTree>` so we only mount one Radix portal at a time.
// The folder row was previously a single <button>; HTML forbids nesting
// a button (the ⋮) inside another button, so FolderNode is now a
// `<div role="button" tabIndex={0}>` with a keyboard handler — same
// affordance, legal markup. The doc row splits Link and ⋮ into siblings
// inside a wrapper for the same reason (can't nest a <button> inside <a>).

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { MoreHorizontal } from 'lucide-react';

import { getFreshness } from '@/lib/brain/freshness';
import type { ManifestDocument, ManifestFolder } from '@/lib/brain/manifest';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CreateFolderDialog,
  DeleteFolderDialog,
  MoveDocumentDialog,
  RenameFolderDialog,
} from '@/components/brain/folder-dialogs';
import { togglePinAction } from '@/app/(app)/brain/actions';

// ---------------------------------------------------------------------------
// Dialog state machine. Lifted to the top-level `BrainTree` so the whole
// subtree shares a single dialog instance — avoids N concurrent Radix
// portals on deep trees and keeps close-animation timing sane.
// ---------------------------------------------------------------------------

type DialogState =
  | { type: 'none' }
  | { type: 'create'; parentId: string | null; parentName: string | null }
  | { type: 'rename'; folderId: string; currentName: string }
  | {
      type: 'delete';
      folderId: string;
      folderName: string;
      hasChildren: boolean;
      hasDocuments: boolean;
    }
  | { type: 'move'; documentId: string; currentFolderId: string };

interface BrainTreeProps {
  tree: ManifestFolder[];
}

interface TreeContext {
  tree: ManifestFolder[];
  setDialog: (s: DialogState) => void;
}

export function BrainTree({ tree }: BrainTreeProps) {
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const close = () => setDialog({ type: 'none' });

  const ctx: TreeContext = { tree, setDialog };

  return (
    <>
      {tree.map((folder) => (
        <FolderNode key={folder.id} folder={folder} ctx={ctx} />
      ))}

      {dialog.type === 'create' && (
        <CreateFolderDialog
          open
          onOpenChange={(o) => !o && close()}
          parentId={dialog.parentId}
          parentName={dialog.parentName}
        />
      )}
      {dialog.type === 'rename' && (
        <RenameFolderDialog
          open
          onOpenChange={(o) => !o && close()}
          folderId={dialog.folderId}
          currentName={dialog.currentName}
        />
      )}
      {dialog.type === 'delete' && (
        <DeleteFolderDialog
          open
          onOpenChange={(o) => !o && close()}
          folderId={dialog.folderId}
          folderName={dialog.folderName}
          hasChildren={dialog.hasChildren}
          hasDocuments={dialog.hasDocuments}
        />
      )}
      {dialog.type === 'move' && (
        <MoveDocumentDialog
          open
          onOpenChange={(o) => !o && close()}
          documentId={dialog.documentId}
          tree={tree}
          currentFolderId={dialog.currentFolderId}
        />
      )}
    </>
  );
}

function folderContainsPath(
  folder: ManifestFolder,
  pathname: string | null,
): boolean {
  if (!pathname) return false;
  for (const doc of folder.documents) {
    if (
      pathname === `/brain/${doc.id}` ||
      pathname.startsWith(`/brain/${doc.id}/`)
    ) {
      return true;
    }
  }
  for (const sub of folder.folders) {
    if (folderContainsPath(sub, pathname)) return true;
  }
  return false;
}

function FolderNode({
  folder,
  ctx,
}: {
  folder: ManifestFolder;
  ctx: TreeContext;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Lazy initializer: only runs on mount. We seed `open` so that any folder
  // whose subtree contains the active document starts expanded — otherwise
  // landing on `/brain/<deep-doc-id>` leaves the active doc invisible behind
  // collapsed ancestors.
  //
  // TODO: Currently only auto-expands on mount. Changing routes client-side
  // won't re-open collapsed folders to reveal the new active doc.
  // Acceptable for MVP: users typically navigate within an already-open folder.
  // Fix: lift state to BrainTree + useEffect keyed on pathname.
  const [open, setOpen] = useState(() => folderContainsPath(folder, pathname));
  const childCount = folder.documents.length + folder.folders.length;

  const hasChildren = folder.folders.length > 0;
  const hasDocuments = folder.documents.length > 0;

  const toggle = () => setOpen((prev) => !prev);

  return (
    <div className={open ? 'group open' : 'group'}>
      {/* `div[role=button]` rather than <button> — we need a ⋮ button inside
          the row, and nesting two buttons is invalid HTML. Keyboard handler
          restores Enter/Space activation. */}
      <div
        role="button"
        tabIndex={0}
        className={open ? 'node folder open' : 'node folder'}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        aria-expanded={open}
      >
        <span className="chev" aria-hidden="true">
          ›
        </span>
        <span className="node-bullet" aria-hidden="true">
          ▪
        </span>
        <span className="node-label">{folder.name}</span>
        {childCount > 0 && <span className="node-badge">{childCount}</span>}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for ${folder.name}`}
              className="node-more ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                ctx.setDialog({
                  type: 'create',
                  parentId: folder.id,
                  parentName: folder.name,
                })
              }
            >
              New folder
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => router.push(`/brain/new?folderId=${folder.id}`)}
            >
              New doc
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                ctx.setDialog({
                  type: 'rename',
                  folderId: folder.id,
                  currentName: folder.name,
                })
              }
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                ctx.setDialog({
                  type: 'delete',
                  folderId: folder.id,
                  folderName: folder.name,
                  hasChildren,
                  hasDocuments,
                })
              }
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="children">
        {/* Docs first, then sub-folders — matches the mockup hierarchy. */}
        {folder.documents.map((doc) => (
          <DocNode key={doc.id} doc={doc} folderId={folder.id} ctx={ctx} />
        ))}
        {folder.folders.map((sub) => (
          <FolderNode key={sub.id} folder={sub} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function DocNode({
  doc,
  folderId,
  ctx,
}: {
  doc: ManifestDocument;
  folderId: string;
  ctx: TreeContext;
}) {
  const pathname = usePathname();
  const href = `/brain/${doc.id}`;
  const isActive =
    pathname === href || (pathname?.startsWith(`${href}/`) ?? false);
  // Staleness tier drives the dim/dot treatment in CSS via `data-freshness`.
  // Computed per render — cheap (one Date parse + subtract) and avoids a
  // stale cached value if the user idles past a tier boundary.
  const freshness = getFreshness(doc.updatedAt, doc.confidenceLevel);

  const [pinPending, startPinTransition] = useTransition();

  // The ⋮ button sits as a sibling of the <Link> (nested interactive
  // elements inside <a> are invalid). The wrapper carries the `group/doc`
  // tailwind group modifier so `group-hover/doc` on the button targets
  // just this row, not the folder row's hover state.
  return (
    <div className="group/doc relative flex items-center">
      <Link
        href={href}
        className="node doc leaf flex-1 min-w-0"
        data-active={isActive ? 'true' : undefined}
        data-freshness={freshness}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className="chev" aria-hidden="true">
          ›
        </span>
        <span className="node-bullet" aria-hidden="true">
          ·
        </span>
        <span className="node-label">{doc.title}</span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More actions for ${doc.title}`}
            className="node-more absolute right-2 opacity-0 group-hover/doc:opacity-100 focus:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal size={14} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={pinPending}
            onSelect={() => {
              startPinTransition(async () => {
                try {
                  await togglePinAction(doc.id);
                } catch (e) {
                  console.error('[brain-tree] togglePin failed', e);
                }
              });
            }}
          >
            {doc.isPinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              ctx.setDialog({
                type: 'move',
                documentId: doc.id,
                currentFolderId: folderId,
              })
            }
          >
            Move…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

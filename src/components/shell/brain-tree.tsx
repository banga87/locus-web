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

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { getFreshness } from '@/lib/brain/freshness';
import type { ManifestDocument, ManifestFolder } from '@/lib/brain/manifest';

interface BrainTreeProps {
  tree: ManifestFolder[];
}

export function BrainTree({ tree }: BrainTreeProps) {
  return (
    <>
      {tree.map((folder) => (
        <FolderNode key={folder.id} folder={folder} />
      ))}
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

function FolderNode({ folder }: { folder: ManifestFolder }) {
  const pathname = usePathname();
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

  return (
    <div className={open ? 'group open' : 'group'}>
      <button
        type="button"
        className={open ? 'node folder open' : 'node folder'}
        onClick={() => setOpen((prev) => !prev)}
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
      </button>
      <div className="children">
        {/* Docs first, then sub-folders — matches the mockup hierarchy. */}
        {folder.documents.map((doc) => (
          <DocNode key={doc.id} doc={doc} />
        ))}
        {folder.folders.map((sub) => (
          <FolderNode key={sub.id} folder={sub} />
        ))}
      </div>
    </div>
  );
}

function DocNode({ doc }: { doc: ManifestDocument }) {
  const pathname = usePathname();
  const href = `/brain/${doc.id}`;
  const isActive =
    pathname === href || (pathname?.startsWith(`${href}/`) ?? false);
  // Staleness tier drives the dim/dot treatment in CSS via `data-freshness`.
  // Computed per render — cheap (one Date parse + subtract) and avoids a
  // stale cached value if the user idles past a tier boundary.
  const freshness = getFreshness(doc.updatedAt, doc.confidenceLevel);

  return (
    <Link
      href={href}
      className="node doc leaf"
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
  );
}

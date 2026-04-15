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

function FolderNode({ folder }: { folder: ManifestFolder }) {
  const [open, setOpen] = useState(false);
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

  return (
    <Link
      href={href}
      className="node doc leaf"
      data-active={isActive ? 'true' : undefined}
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

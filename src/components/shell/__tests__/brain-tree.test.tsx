// BrainTree — recursive folder/document sidebar tree. Verifies:
//  - top-level folders render, collapsed by default
//  - click toggles expand/collapse (visibility controlled by `.group.open`)
//  - nested folders render recursively
//  - documents inside an open folder render as links
//  - the document whose id matches the pathname gets data-active="true"
//
// `usePathname` is mocked at module scope; individual tests override the
// return value via `vi.mocked(usePathname).mockReturnValue(...)` when they
// need a specific path.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';

import { BrainTree } from '@/components/shell/brain-tree';
import type { ManifestFolder } from '@/lib/brain/manifest';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/'),
  // Task 9: <FolderNode> dispatches to `/brain/new?folderId=...` from the
  // context-menu "New doc" action via useRouter().push. Mock is a no-op
  // for the rendering/expand assertions in this file.
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
}));

const tree: ManifestFolder[] = [
  {
    id: 'f1',
    slug: 'brand',
    name: 'Brand & Identity',
    description: null,
    folders: [],
    documents: [
      {
        id: 'd1',
        path: 'brand/mission',
        title: 'Mission',
        summary: null,
        confidenceLevel: 'high',
        status: 'active',
        isCore: true,
        isPinned: false,
        updatedAt: '2026-04-01T00:00:00Z',
      },
    ],
  },
  {
    id: 'f2',
    slug: 'product',
    name: 'Product',
    description: null,
    folders: [
      {
        id: 'f3',
        slug: 'terravolt',
        name: 'Terravolt',
        description: null,
        folders: [],
        documents: [
          {
            id: 'd2',
            path: 'product/terravolt/grid',
            title: 'Energy Grid',
            summary: null,
            confidenceLevel: 'medium',
            status: 'draft',
            isCore: false,
            isPinned: false,
            updatedAt: '2026-04-10T00:00:00Z',
          },
        ],
      },
    ],
    documents: [
      {
        id: 'd3',
        path: 'product/overview',
        title: 'Overview',
        summary: null,
        confidenceLevel: 'high',
        status: 'active',
        isCore: true,
        isPinned: true,
        updatedAt: '2026-04-15T00:00:00Z',
      },
    ],
  },
];

describe('BrainTree', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/');
  });

  it('renders top-level folders', () => {
    render(<BrainTree tree={tree} />);
    expect(screen.getByText('Brand & Identity')).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument();
  });

  it('folders start collapsed — children not visible', () => {
    render(<BrainTree tree={tree} />);
    // Documents DOM-render but their container `.children` is display:none
    // via `.group:not(.open) > .children`. Assert via the `.group` class
    // state, which tests use directly.
    const brandGroup = screen.getByText('Brand & Identity').closest('.group');
    expect(brandGroup).not.toBeNull();
    expect(brandGroup!.classList.contains('open')).toBe(false);
  });

  it('expands a folder on click', () => {
    render(<BrainTree tree={tree} />);
    // Filter to the folder-row button (has aria-expanded) — the ⋮ context
    // menu trigger also has "Brand & Identity" in its name.
    const folderButton = screen
      .getAllByRole('button', { name: /Brand & Identity/ })
      .find((el) => el.hasAttribute('aria-expanded'))!;
    fireEvent.click(folderButton);

    const brandGroup = folderButton.closest('.group');
    expect(brandGroup!.classList.contains('open')).toBe(true);
    expect(folderButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapses an open folder on click', () => {
    render(<BrainTree tree={tree} />);
    // Filter to the folder-row button (has aria-expanded) — the ⋮ context
    // menu trigger also has "Brand & Identity" in its name.
    const folderButton = screen
      .getAllByRole('button', { name: /Brand & Identity/ })
      .find((el) => el.hasAttribute('aria-expanded'))!;

    fireEvent.click(folderButton); // open
    fireEvent.click(folderButton); // close

    const brandGroup = folderButton.closest('.group');
    expect(brandGroup!.classList.contains('open')).toBe(false);
    expect(folderButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders nested folders recursively', () => {
    render(<BrainTree tree={tree} />);
    // "Terravolt" is a sub-folder inside "Product" — it renders in the DOM
    // even when its parent is collapsed (CSS hides via `.children` display).
    expect(screen.getByText('Terravolt')).toBeInTheDocument();
  });

  it('renders document links inside folders', () => {
    render(<BrainTree tree={tree} />);
    const missionLink = screen.getByRole('link', { name: /Mission/ });
    expect(missionLink).toBeInTheDocument();
    expect(missionLink.getAttribute('href')).toBe('/brain/d1');
  });

  it('marks the active doc with data-active="true" when pathname matches', () => {
    vi.mocked(usePathname).mockReturnValue('/brain/d1');
    render(<BrainTree tree={tree} />);
    const missionLink = screen.getByRole('link', { name: /Mission/ });
    expect(missionLink.getAttribute('data-active')).toBe('true');

    // A non-matching doc should not be marked active
    const overviewLink = screen.getByRole('link', { name: /Overview/ });
    expect(overviewLink.getAttribute('data-active')).toBeNull();
  });

  it('treats nested sub-paths as active (e.g. /brain/d1/edit)', () => {
    vi.mocked(usePathname).mockReturnValue('/brain/d1/edit');
    render(<BrainTree tree={tree} />);
    const missionLink = screen.getByRole('link', { name: /Mission/ });
    expect(missionLink.getAttribute('data-active')).toBe('true');
  });

  it('starts expanded when it contains the active document', () => {
    vi.mocked(usePathname).mockReturnValue('/brain/d2');
    render(<BrainTree tree={tree} />);
    // Product and Terravolt should both have .open class — d2 lives in
    // Product → Terravolt, so both ancestors must auto-expand on mount.
    const productGroup = screen
      .getAllByRole('button', { name: /Product/ })
      .find((el) => el.hasAttribute('aria-expanded'))!
      .closest('.group');
    const terravoltGroup = screen
      .getAllByRole('button', { name: /Terravolt/ })
      .find((el) => el.hasAttribute('aria-expanded'))!
      .closest('.group');
    expect(productGroup?.classList.contains('open')).toBe(true);
    expect(terravoltGroup?.classList.contains('open')).toBe(true);
  });

  it('starts collapsed when it does not contain the active document', () => {
    vi.mocked(usePathname).mockReturnValue('/brain/d1'); // d1 is in Brand, not Product
    render(<BrainTree tree={tree} />);
    const productGroup = screen
      .getAllByRole('button', { name: /Product/ })
      .find((el) => el.hasAttribute('aria-expanded'))!
      .closest('.group');
    expect(productGroup?.classList.contains('open')).toBe(false);
  });

  it('sets data-freshness on document nodes based on updatedAt + confidence', () => {
    // Build a fixture with two docs at known ages so tier boundaries are
    // deterministic. 200 days old + high confidence = stale (threshold 180).
    // "Right now" + high confidence = fresh. Docs render regardless of the
    // parent folder's open/closed state (see "renders nested folders" note
    // above — `.children` is display:none via CSS but the nodes are in the
    // DOM), so no click-to-expand is needed.
    const staleFolder: ManifestFolder = {
      id: 'f-test',
      slug: 'test',
      name: 'Test',
      description: null,
      folders: [],
      documents: [
        {
          id: 'old',
          path: 'x',
          title: 'Old Doc',
          summary: null,
          confidenceLevel: 'high',
          status: 'active',
          isCore: false,
          isPinned: false,
          updatedAt: new Date(
            Date.now() - 200 * 86_400_000,
          ).toISOString(),
        },
        {
          id: 'new',
          path: 'y',
          title: 'New Doc',
          summary: null,
          confidenceLevel: 'high',
          status: 'active',
          isCore: false,
          isPinned: false,
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    render(<BrainTree tree={[staleFolder]} />);
    const oldLink = screen.getByRole('link', { name: /Old Doc/ });
    const newLink = screen.getByRole('link', { name: /New Doc/ });
    expect(oldLink.getAttribute('data-freshness')).toBe('stale');
    expect(newLink.getAttribute('data-freshness')).toBe('fresh');
  });
});

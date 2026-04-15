'use client';

// Single-column sidebar shell. Replaces the old two-sidebar layout with
// the Fraunces/Forest design from mockups/ui-exploration/fraunces-forest.html.
//
// The Brain section delegates to <BrainTree>, which is a client component
// that uses `usePathname()` to drive the `[data-active="true"]` node and
// holds per-folder expand/collapse state locally.

import Link from 'next/link';

import type { ManifestFolder } from '@/lib/brain/manifest';

import { BrainTree } from './brain-tree';
import { WorkspaceRow } from './workspace-row';

interface NewSidebarProps {
  companyName: string;
  user: { email: string; fullName: string | null; role: string };
  tree: ManifestFolder[];
  pinned: Array<{ id: string; title: string; path: string }>;
}

function countDocs(folders: ManifestFolder[]): number {
  let n = 0;
  for (const f of folders) {
    n += f.documents.length + countDocs(f.folders);
  }
  return n;
}

export function NewSidebar({
  companyName,
  user,
  tree,
  pinned,
}: NewSidebarProps) {
  const docCount = countDocs(tree);
  const userInitials = (user.fullName ?? user.email)
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const userHandle = user.email.split('@')[0];

  return (
    <aside className="side">
      <div className="brand">
        <span className="brand-name">Locus</span>
        <span className="brand-dot" aria-hidden="true" />
        <span className="brand-tag">v0.1</span>
      </div>

      <WorkspaceRow companyName={companyName} />

      <div className="quick">
        {/* Placeholder for ⌘K command palette — wired in a later task.
            Intentionally a plain div (no role/tabIndex) so we don't
            advertise interactivity that doesn't exist yet; the "Search ⌘K"
            text is still readable by screen readers as visible content. */}
        <div className="quick-item">
          <SearchIcon />
          Search
          <span className="kbd">⌘K</span>
        </div>
        <Link href="/" className="quick-item">
          <HomeIcon />
          Home
        </Link>
        <Link href="/recent" className="quick-item">
          <RecentIcon />
          Recent
        </Link>
      </div>

      <div className="side-body">
        <div className="section-label">
          <span className="label">Brain</span>
          <span className="count">{docCount} DOCS</span>
        </div>

        <BrainTree tree={tree} />

        {pinned.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: 12 }}>
              <span className="label">Pinned</span>
            </div>
            {pinned.map((p) => (
              <Link
                key={p.id}
                href={`/brain/${p.id}`}
                className="node doc leaf"
              >
                <span className="chev">›</span>
                <span
                  className="node-bullet"
                  style={{ color: 'var(--accent-2)' }}
                >
                  ◆
                </span>
                <span className="node-label">{p.title}</span>
              </Link>
            ))}
          </>
        )}
      </div>

      <div className="nav-bottom">
        <Link href="/chat" className="quick-item">
          <ChatIcon />
          Chat
        </Link>
        <Link href="/mcp" className="quick-item">
          <McpIcon />
          MCP Connections
        </Link>
        <Link href="/settings" className="quick-item">
          <SettingsIcon />
          Settings
        </Link>
      </div>

      <div className="user-row">
        <div className="user-av">{userInitials || '?'}</div>
        <div>
          <div className="user-name">{user.fullName ?? user.email}</div>
          <div className="user-sub">{userHandle}</div>
        </div>
      </div>
    </aside>
  );
}

// --- Inline SVG icons ------------------------------------------------------
// Stroke paths lifted from the fraunces-forest.html mockup. Kept inline
// (rather than in a separate icons.tsx) to keep the shell self-contained;
// if more surfaces need the same icons we'll extract at that point.

function SearchIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function RecentIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function McpIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 2v4M16 2v4M3 10h18" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 10-14 0 7 7 0 0014 0z" />
    </svg>
  );
}

'use client';

// Expanded sidebar — the "full" width mode (220–480px user-resizable).
// Extracted from the legacy new-sidebar.tsx so it can coexist with
// <SidebarRail /> behind a mode-switching <Sidebar />. The collapse
// toggle button in .brand is added in Task 6; this task keeps the
// brand block identical to the legacy file so rendering is unchanged.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { BookOpen, PanelLeftClose, Plug } from 'lucide-react';

import type { ManifestFolder } from '@/lib/brain/manifest';
import { useSidebarLayout } from '@/lib/sidebar/use-sidebar-layout';

import { ThemeToggleNav } from '../theme-toggle';
import { WorkspaceRow } from '../workspace-row';
import { BrainSection } from './sections/brain-section';
import { PinnedSection } from './sections/pinned-section';

interface SidebarExpandedProps {
  companyName: string;
  user: { email: string; fullName: string | null; role: string };
  tree: ManifestFolder[];
  pinned: Array<{ id: string; title: string; path: string }>;
  /** Slot for the GlobalRunBadge server component rendered by the layout. */
  workflowsBadge?: ReactNode;
}

export function SidebarExpanded({ companyName, user, tree, pinned, workflowsBadge }: SidebarExpandedProps) {
  const { collapsed, toggleCollapsed } = useSidebarLayout();
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
        <div className="brand-right">
          <span className="brand-tag">v0.1</span>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            className="brand-collapse"
            aria-expanded={!collapsed}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
      </div>

      <WorkspaceRow companyName={companyName} />

      <div className="quick">
        <div className="quick-item">
          <SearchIcon />
          Search
          <span className="kbd">⌘K</span>
        </div>
        <Link href="/home" className="quick-item">
          <HomeIcon />
          Home
        </Link>
        <Link href="/recent" className="quick-item">
          <RecentIcon />
          Recent
        </Link>
        <Link href="/neurons" className="quick-item">
          <NeuronsIcon />
          Neurons
        </Link>
        <Link href="/skills" className="quick-item">
          <BookOpen size={15} />
          Skills
        </Link>
        {workflowsBadge}
      </div>

      <div className="side-body">
        <BrainSection tree={tree} />
        <PinnedSection pinned={pinned} />
      </div>

      <div className="nav-bottom">
        <Link href="/chat" className="quick-item">
          <ChatIcon />
          Chat
        </Link>
        <Link href="/connectors" className="quick-item">
          <Plug size={15} />
          Connectors
        </Link>
        <Link href="/settings" className="quick-item">
          <SettingsIcon />
          Settings
        </Link>
        <ThemeToggleNav />
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

// Inline SVG icons — copied verbatim from new-sidebar.tsx so rendering
// is byte-identical. A follow-up task can consolidate into a shared
// icons module; keeping them local for now avoids churn.

function SearchIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>); }
function HomeIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" /></svg>); }
function RecentIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>); }
function ChatIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>); }
function SettingsIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 10-14 0 7 7 0 0014 0z" /></svg>); }
function NeuronsIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="3" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" /><circle cx="4" cy="18" r="2" /><circle cx="20" cy="18" r="2" /><path d="M6 7l4 4M18 7l-4 4M6 17l4-4M18 17l-4-4" /></svg>); }

'use client';

// Expanded sidebar — the "full" width mode (220–480px user-resizable).
// Extracted from the legacy new-sidebar.tsx so it can coexist with
// <SidebarRail /> behind a mode-switching <Sidebar />. The collapse
// toggle button in .brand is added in Task 6; this task keeps the
// brand block identical to the legacy file so rendering is unchanged.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Wordmark, Icon } from '@/components/tatara';

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
        <Wordmark size={22} />
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
            <Icon name="PanelLeftClose" size={16} />
          </button>
        </div>
      </div>

      <WorkspaceRow companyName={companyName} />

      <div className="quick">
        <div className="quick-item">
          <Icon name="Search" size={16} />
          Search
          <span className="kbd">⌘K</span>
        </div>
        <Link href="/home" className="quick-item">
          <Icon name="Home" size={16} />
          Home
        </Link>
        <Link href="/recent" className="quick-item">
          <Icon name="Clock" size={16} />
          Recent
        </Link>
        <Link href="/neurons" className="quick-item">
          <Icon name="Network" size={16} />
          Neurons
        </Link>
        <Link href="/skills" className="quick-item">
          <Icon name="BookOpen" size={16} />
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
          <Icon name="MessageSquare" size={16} />
          Chat
        </Link>
        <Link href="/connectors" className="quick-item">
          <Icon name="Plug" size={16} />
          Connectors
        </Link>
        <Link href="/settings" className="quick-item">
          <Icon name="Settings" size={16} />
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


// Minimal two-column shell: sidebar (left) + main (right) on md+.
// Below md, the desktop grid column is hidden via globals.css and
// navigation moves into MobileTopBar + MobileNavSheet.

import type { ReactNode } from 'react';

import type { ManifestFolder } from '@/lib/brain/manifest';

import { MobileNavSheet } from './mobile-nav-sheet';
import { MobileTopBar } from './mobile-top-bar';
import { Sidebar } from './sidebar/sidebar';
import { ResizeHandle } from './sidebar/resize-handle';

interface NewAppShellProps {
  children: ReactNode;
  companyName: string;
  user: { email: string; fullName: string | null; role: string };
  tree: ManifestFolder[];
  pinned: Array<{ id: string; title: string; path: string }>;
  /** Slot for the GlobalRunBadge server component (rendered by the layout). */
  workflowsBadge?: ReactNode;
}

export function NewAppShell({ children, workflowsBadge, ...props }: NewAppShellProps) {
  return (
    <div className="app">
      <MobileTopBar>
        <MobileNavSheet {...props} workflowsBadge={workflowsBadge} />
      </MobileTopBar>
      <Sidebar {...props} workflowsBadge={workflowsBadge} />
      <ResizeHandle />
      <section className="main">
        {children}
      </section>
    </div>
  );
}

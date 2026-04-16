// Minimal two-column shell: sidebar (left) + main (right). The grid
// template and surface colours come from `.app` / `.side` / `.main` in
// globals.css. Below 768px the sidebar becomes a fixed overlay drawer
// triggered by SidebarMobileTrigger; a dedicated mobile pass is deferred.

import type { ReactNode } from 'react';

import type { ManifestFolder } from '@/lib/brain/manifest';

import { Sidebar } from './sidebar/sidebar';
import { ResizeHandle } from './sidebar/resize-handle';
import { SidebarMobileTrigger } from './sidebar/sidebar-mobile-trigger';

interface NewAppShellProps {
  children: ReactNode;
  companyName: string;
  user: { email: string; fullName: string | null; role: string };
  tree: ManifestFolder[];
  pinned: Array<{ id: string; title: string; path: string }>;
}

export function NewAppShell({ children, ...props }: NewAppShellProps) {
  return (
    <div className="app">
      <Sidebar {...props} />
      <ResizeHandle />
      <section className="main">
        <SidebarMobileTrigger />
        {children}
      </section>
    </div>
  );
}

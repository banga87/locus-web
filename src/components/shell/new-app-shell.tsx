'use client';

// Minimal two-column shell: sidebar (left) + main (right). The grid
// template and surface colours come from `.app` / `.side` / `.main` in
// globals.css. Mobile responsiveness is deferred post-MVP — below the
// 280px sidebar the layout simply overflows; existing tests / users are
// desktop-first for now.

import type { ReactNode } from 'react';

import type { ManifestFolder } from '@/lib/brain/manifest';

import { NewSidebar } from './new-sidebar';

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
      <NewSidebar {...props} />
      <section className="main">{children}</section>
    </div>
  );
}

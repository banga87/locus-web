'use client';

import { useEffect } from 'react';

import { ensureSidebarHydrated, toggleSidebarCollapsedImperative } from '@/lib/sidebar/use-sidebar-layout';

// Mounts once in (app)/layout.tsx. Hydrates the sidebar store on the
// client so subsequent reads return persisted state. Also binds the
// global Cmd/Ctrl+\ keyboard shortcut for collapse/expand.
export function SidebarLayoutBoot() {
  useEffect(() => {
    ensureSidebarHydrated();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggleSidebarCollapsedImperative();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

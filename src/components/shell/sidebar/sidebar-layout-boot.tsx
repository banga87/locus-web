'use client';

import { useEffect, useLayoutEffect } from 'react';

// useLayoutEffect fires before paint; useEffect is the SSR-safe fallback.
// This component is 'use client' but Next.js still pre-renders it on the
// server, so the isomorphic wrapper suppresses the React SSR warning.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

import { ensureSidebarHydrated, toggleSidebarCollapsedImperative } from '@/lib/sidebar/use-sidebar-layout';

// Mounts once in (app)/layout.tsx. Hydrates the sidebar store on the
// client so subsequent reads return persisted state. Also binds the
// global Cmd/Ctrl+\ keyboard shortcut for collapse/expand.
export function SidebarLayoutBoot() {
  useIsomorphicLayoutEffect(() => {
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

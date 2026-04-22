// src/components/shell/mobile-nav-sheet.tsx
'use client';

// Mobile nav drawer. Owns the Sheet open state + two auto-close effects:
//   1. Pathname change (handles every in-app navigation, including
//      link taps, programmatic router.push, and middleware redirects).
//   2. Viewport crossing into desktop (min-width: 768px) while open —
//      the drawer becomes invisible at md+; closing it prevents it
//      being "stuck" open after rotation.
//
// Rendered inside a single <Sheet> so trigger and content share state.
// The trigger is positioned inside MobileTopBar via normal DOM flow;
// the SheetContent is portaled to <body> by Radix.

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { Icon } from '@/components/tatara';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { SidebarExpanded } from './sidebar/sidebar-expanded';
import type { ManifestFolder } from '@/lib/brain/manifest';

interface MobileNavSheetProps {
  companyName: string;
  user: { email: string; fullName: string | null; role: string };
  tree: ManifestFolder[];
  pinned: Array<{ id: string; title: string; path: string }>;
  workflowsBadge?: ReactNode;
}

export function MobileNavSheet(props: MobileNavSheetProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close when the route changes. This is the single source of
  // truth for closing on navigation — we do NOT also listen on link
  // clicks, to avoid racing router.push().
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close when viewport crosses into desktop (e.g. tablet rotation).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)]"
        >
          <Icon name="Menu" size={20} />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[85vw] max-w-[320px] gap-0 overflow-y-auto rounded-none border-0 p-0 shadow-xl"
      >
        <div className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Primary navigation menu</SheetDescription>
        </div>
        <SidebarExpanded {...props} />
      </SheetContent>
    </Sheet>
  );
}

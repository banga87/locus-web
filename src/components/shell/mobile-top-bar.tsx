'use client';

// Fixed top bar shown below md (768px). Center column renders the
// Tatara wordmark; left slot takes a child (the sheet trigger);
// right slot is a reserved 44x44 placeholder so the wordmark stays
// optically centered until we wire in search or an avatar.

import type { ReactNode } from 'react';

import { Wordmark } from '@/components/tatara';

interface MobileTopBarProps {
  children: ReactNode;
}

export function MobileTopBar({ children }: MobileTopBarProps) {
  return (
    <header
      className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--rule-1)] bg-[var(--surface-0)] px-2 md:hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex h-11 w-11 items-center justify-center">{children}</div>
      <div className="flex items-center gap-1">
        <Wordmark size={20} />
        <span className="brand-dot" aria-hidden="true" />
      </div>
      <div className="h-11 w-11" aria-hidden="true" />
    </header>
  );
}

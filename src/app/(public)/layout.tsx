// Shared shell for unauthenticated pages: login, signup, verify-email.
// Intentionally spartan — no nav, no sidebar, just a centered column with
// the Tatara wordmark so every auth page feels consistent.

import type { ReactNode } from 'react';

import { PaperGrain, Wordmark } from '@/components/tatara';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <PaperGrain className="flex flex-1 flex-col items-center justify-center bg-[var(--surface-0)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>
        {children}
      </div>
    </PaperGrain>
  );
}

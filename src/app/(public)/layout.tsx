// Shared shell for unauthenticated pages: login, signup, verify-email.
// Intentionally spartan — no nav, no sidebar, just a centered column with
// the Locus wordmark so every auth page feels consistent.

import type { ReactNode } from 'react';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-2xl font-semibold tracking-tight text-foreground">
            Locus
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

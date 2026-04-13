// Minimal layout for the setup wizard. No app chrome — the user doesn't
// have a company yet, so a sidebar or dashboard frame would be misleading.

import type { ReactNode } from 'react';

export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="w-full max-w-md">
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

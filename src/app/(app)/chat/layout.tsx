// /chat layout — chat surface fills the available `<main>` height and
// owns its own scroll regions (session sidebar + message stream both
// scroll independently). The wrapping app shell's `<main>` has
// `overflow-auto`, so we set `min-h-0` here to let our flex children
// shrink properly inside it without forcing the whole page to scroll.
//
// The session sidebar is composed inline by the per-session page (so
// it can read `params.sessionId` for the active highlight). This
// layout only has to be a frame.

import type { ReactNode } from 'react';

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
      {children}
    </div>
  );
}

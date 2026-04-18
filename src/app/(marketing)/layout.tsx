// Public marketing shell. Server Component. No auth — anyone hitting `/` gets
// this layout. The wrapper <div class="tatara-marketing"> is the CSS scoping
// root for marketing-only tokens and styles (see marketing.css). Scoping keeps
// the cream/brass marketing palette from colliding with the green/rust app
// palette (`:root` / `[data-theme]` tokens in globals.css).
//
// Intentionally minimal in this task (scaffold). Task 4 adds session-aware
// nav; Task 7 adds footer.

import type { ReactNode } from 'react';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  // <main> landmark lives at the layout level so every marketing route gets
  // the a11y landmark for free. Hero, sections, etc. remain <section>s.
  return (
    <div className="tatara-marketing">
      <main>{children}</main>
    </div>
  );
}

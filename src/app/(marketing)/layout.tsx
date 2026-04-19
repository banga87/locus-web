// Public marketing shell. Server Component. No auth — anyone hitting `/` gets
// this layout. `<PaperGrain>` applies the letterpress SVG-noise overlay from
// globals.css's `.paper` rule so every marketing route gets the printed-on-
// paper texture without per-section wiring.

import type { ReactNode } from 'react';

import { PaperGrain } from '@/components/tatara';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  // <main> landmark lives at the layout level so every marketing route gets
  // the a11y landmark for free. Hero, sections, etc. remain <section>s.
  return (
    <PaperGrain>
      <main>{children}</main>
    </PaperGrain>
  );
}

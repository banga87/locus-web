// Shared wrapper for the marketing mid-page sections (HowItWorks, Features,
// Positioning — and later PricingTeaser). Server Component. Keeps section
// chrome (id anchor, padding, max-width, SpecLabel header) in one place so
// per-section files focus on content.
//
// Ported from Tatara/components/Sections.jsx lines 3–17. Extended with a
// `dark` prop that flips background + text + spec-label color.

import type { ReactNode } from 'react';
import { SpecLabel } from '@/components/marketing/primitives';
import { cn } from '@/lib/utils';

export interface SectionFrameProps {
  id: string;
  number: string;
  kicker: string;
  children: ReactNode;
  /** When true, flips to the ink-dark treatment used by Features. */
  dark?: boolean;
  className?: string;
}

export function SectionFrame({
  id,
  number,
  kicker,
  children,
  dark = false,
  className,
}: SectionFrameProps) {
  return (
    <section
      id={id}
      className={cn(
        'relative',
        // Padding: 72px/24px on mobile → 112px/48px from 900px up.
        'px-6 py-[72px] min-[900px]:px-12 min-[900px]:py-[112px]',
        className,
      )}
      style={{
        background: dark ? 'var(--mk-ink)' : 'var(--mk-paper)',
        color: dark ? 'var(--mk-paper)' : 'var(--mk-ink)',
      }}
    >
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-14 flex items-start gap-8">
          <SpecLabel
            number={number}
            // Dark override: re-color both the root text and the little
            // horizontal divider span (hardcoded to --mk-ink-3 in the
            // primitive) so the label reads over the ink background.
            className={
              dark
                ? 'text-[color:var(--mk-gold)] [&>span[aria-hidden]]:!bg-[color:var(--mk-gold)]'
                : undefined
            }
          >
            {kicker}
          </SpecLabel>
        </div>
        {children}
      </div>
    </section>
  );
}

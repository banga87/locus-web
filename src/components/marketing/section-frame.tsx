// Shared wrapper for the marketing mid-page sections (HowItWorks, Features,
// Positioning, PricingTeaser). Server Component.
//
// Task 5.5 refactor: delegates the section header to the Tatara design
// system. When `title` is passed, renders the full <SectionHeader> (eyebrow
// + h2 + rule). When it's omitted (the current behavior for Features /
// Positioning / PricingTeaser, which each own their own <h2>), renders just
// the <Eyebrow> so those callers stay unbroken.
//
// Uses the semantic Tatara tokens (`--surface-0`, `--ink-1`,
// `--ink-inverse`, `--brass-soft`) plus a `#1B1410` literal for the dark
// background (no exact surface token maps to that warm near-black in the
// current palette).

import type { ReactNode } from 'react';
import { Eyebrow, SectionHeader } from '@/components/tatara';
import { cn } from '@/lib/utils';

export interface SectionFrameProps {
  id: string;
  number: string;
  kicker: string;
  /**
   * When present, delegates to `<SectionHeader>` so the big `<h2>` is
   * owned by the frame. When absent, only the eyebrow is rendered and
   * the caller keeps ownership of its own heading.
   */
  title?: string;
  children: ReactNode;
  /** When true, flips to the ink-dark treatment used by Features. */
  dark?: boolean;
  className?: string;
}

export function SectionFrame({
  id,
  number,
  kicker,
  title,
  children,
  dark = false,
  className,
}: SectionFrameProps) {
  // Dark sections need the eyebrow in brass so it reads over the ink
  // background. SectionHeader's internal Eyebrow doesn't expose a color
  // prop, so on dark we always render our own Eyebrow (and the caller's
  // own <h2> continues to live inside children).
  const eyebrowColor = dark ? 'var(--brass-soft)' : undefined;

  return (
    <section
      id={id}
      className={cn(
        'relative',
        // Padding: 72px/24px on mobile → 112px/48px from `lg:` (1024px) up.
        'px-6 py-[72px] lg:px-12 lg:py-[112px]',
        className,
      )}
      style={{
        background: dark ? '#1B1410' : 'var(--surface-0)',
        color: dark ? 'var(--ink-inverse)' : 'var(--ink-1)',
      }}
    >
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-14">
          {title && !dark ? (
            <SectionHeader number={number} eyebrow={kicker} title={title} />
          ) : (
            <Eyebrow number={number} color={eyebrowColor}>
              {kicker}
            </Eyebrow>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}

// Tatara marketing hero — Variation A (Full-Bleed).
// Server Component. The embedded <Nav /> is a Client Component, which is
// fine: Server → Client import is allowed in Next 16. The hero itself owns
// no state.
//
// Structure:
//   <section>
//     <div image-band>
//       <Nav />            ← absolute, over image
//       <div top scrim />  ← nav readability
//       <div bottom fade />← blends photo into cream deck
//     </div>
//     <div copy deck>
//       SpecLabel, h1, subhead, CTAs, badge
//     </div>
//   </section>
//
// Image src: /images/hero.jpg (existing). Task 8 will generate
// /images/hero-2400.jpg and swap the src here.

import Image from 'next/image';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import {
  BrassButton,
  GaugeNeedle,
  GhostButton,
  SpecLabel,
} from '@/components/marketing/primitives';
import { Nav } from '@/components/marketing/nav';

export interface HeroProps {
  authed?: boolean;
}

const HERO_ALT =
  'A Victorian engine hall at working temperature: an operator at the controls, brass gauges warm with firelight, a flywheel spinning slowly in the background.';

// Inline style for the h1 — variable-font axes + display-font setup. Kept
// inline (not a class) because the variation-settings string is one-off.
const H1_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 400,
  fontSize: 'clamp(48px, 7.5vw, 112px)',
  lineHeight: 0.98,
  letterSpacing: '-0.025em',
  color: 'var(--mk-ink)',
  margin: '22px 0 0',
  maxWidth: 1100,
  fontVariationSettings: '"SOFT" 40, "WONK" 0, "opsz" 144',
  textWrap: 'balance',
};

const SUBHEAD_STYLE: CSSProperties = {
  fontFamily: 'var(--font-body), system-ui, sans-serif',
  fontSize: 19,
  lineHeight: 1.55,
  color: 'var(--mk-ink-2)',
  maxWidth: 640,
  margin: '28px 0 0',
  textWrap: 'pretty',
};

export function Hero({ authed = false }: HeroProps) {
  return (
    <section
      id="the-promise"
      className="relative w-full overflow-hidden"
      style={{ background: 'var(--mk-paper)' }}
    >
      {/* Image band — responsive height via arbitrary Tailwind breakpoints.
          <900px: 48vh (min 440), 900–1279px: 55vh, ≥1280px: 62vh. */}
      <div className="relative h-[48vh] min-h-[440px] w-full min-[900px]:h-[55vh] min-[1280px]:h-[62vh]">
        <Image
          src="/images/hero.jpg"
          alt={HERO_ALT}
          fill
          sizes="100vw"
          priority
          className="object-cover object-[center_30%]"
        />

        {/* Nav sits over the photo. Defaults: absolute, dark (light text). */}
        <Nav authed={authed} />

        {/* Top scrim — ink @ 35% → transparent. Literals kept intentionally:
            alpha-composited ink color is specific to this overlay, not a
            reusable token. Adding --mk-ink-alpha-35 for one use would be noise. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 top-0 h-[160px]"
          style={{
            background:
              'linear-gradient(to bottom, rgba(27,20,16,0.35) 0%, rgba(27,20,16,0) 100%)',
          }}
        />

        {/* Bottom fade — transparent → cream. The final stop uses the token
            so palette tweaks flow through; the rgba midstop is this gradient's
            own fade curve and has no token equivalent. */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-[45%]"
          style={{
            background:
              'linear-gradient(to bottom, rgba(245,239,227,0) 0%, rgba(245,239,227,0.5) 50%, var(--mk-paper) 100%)',
          }}
        />
      </div>

      {/* Copy deck */}
      <div
        className="relative flex flex-col items-center px-6 pb-[88px] pt-8 text-center min-[900px]:px-12 min-[900px]:pb-[112px] min-[900px]:pt-12"
        style={{ background: 'var(--mk-paper)', marginTop: -1 }}
      >
        <SpecLabel number="01">The Promise</SpecLabel>

        <h1 style={H1_STYLE}>
          The operator&rsquo;s console{' '}
          <span style={{ fontStyle: 'italic', fontWeight: 300 }}>for AI labor.</span>
        </h1>

        <p style={SUBHEAD_STYLE}>
          A markdown-native workspace where you hire AI agents to run real work against your
          documents &mdash; versioned like code, rendered like Notion, with you firmly at the helm.
        </p>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          {/*
            Decision: use non-asChild BrassButton so the italic arrow renders.
            Trade-off: inner content is a plain span, not a <Link>, so the CTA
            is a button element with no href. Switched to asChild + <Link>
            below to get hash-scroll navigation. The arrow is appended manually
            inside the Link child — matches the Tatara prototype's visual spec.
          */}
          <BrassButton size="lg" arrow={false} asChild>
            <Link href="#invitation">
              Request early access
              <span
                className="italic leading-none"
                style={{ fontFamily: 'var(--font-display), serif', fontSize: 18 }}
              >
                →
              </span>
            </Link>
          </BrassButton>
          <GhostButton asChild>
            <Link href="#how-it-works">Read the brief</Link>
          </GhostButton>
        </div>

        <div
          className="mt-7 flex items-center gap-[10px] text-[11px] uppercase tracking-[0.14em]"
          style={{
            fontFamily: 'var(--font-mono), monospace',
            color: 'var(--mk-ink-3)',
          }}
        >
          <GaugeNeedle size={14} />
          <span>Private beta &middot; by invitation</span>
        </div>
      </div>
    </section>
  );
}

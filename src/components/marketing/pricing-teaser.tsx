// Section 06 — "Grades & Rates". Three-tier pricing grid: Apprentice,
// Journeyman, Foundry. Server Component. Ported from
// Tatara/components/Sections.jsx lines 400–519.
//
// Layout notes:
// - Desktop (≥900px): 3 equal columns, single 1px outer rule, 1px vertical
//   dividers between tiers (implemented per-cell via borderRight on all but
//   the last).
// - Mobile (<900px): stacks to 1 column; the vertical dividers collapse and
//   we show horizontal rules between tiers instead.
// - Featured Journeyman tier: --mk-paper-2 background plate plus a ~4px
//   amber (--mk-ember) strip pinned to the tier's top edge.

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { BrassButton, GhostButton } from '@/components/marketing/primitives';
import { SectionFrame } from '@/components/marketing/section-frame';

interface Tier {
  grade: string;
  tagline: string;
  price: string;
  sub: string;
  items: readonly string[];
  featured?: boolean;
  cta: 'apprentice' | 'journeyman' | 'foundry';
}

const TIERS: readonly Tier[] = [
  {
    grade: 'Apprentice',
    tagline: 'For solo operators.',
    price: 'Free',
    sub: 'during beta',
    items: [
      'Unlimited documents',
      'Bring your own API keys',
      'Single workspace',
      'Community support',
    ],
    cta: 'apprentice',
  },
  {
    grade: 'Journeyman',
    tagline: 'For small workshops.',
    price: 'TBD',
    sub: 'per operator / month',
    items: [
      'Everything in Apprentice',
      'Managed model routing',
      'Shared workspaces, branches',
      'Audit log + run history',
      'Priority support',
    ],
    featured: true,
    cta: 'journeyman',
  },
  {
    grade: 'Foundry',
    tagline: 'For teams that forge at scale.',
    price: 'Talk',
    sub: 'with us',
    items: [
      'Everything in Journeyman',
      'Self-hosted or VPC deploy',
      'SSO, SCIM, audit export',
      'Custom agents & tool policies',
      'Named operator on our side',
    ],
    cta: 'foundry',
  },
];

const H2_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 400,
  fontSize: 'clamp(44px, 5vw, 72px)',
  lineHeight: 1.02,
  letterSpacing: '-0.02em',
  margin: 0,
  fontVariationSettings: '"SOFT" 40, "opsz" 144',
};

const GRADE_H3_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 500,
  fontSize: 36,
  lineHeight: 1,
  letterSpacing: '-0.02em',
  margin: 0,
  color: 'var(--mk-ink)',
  fontVariationSettings: '"SOFT" 40',
};

const PRICE_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 400,
  fontSize: 44,
  lineHeight: 1,
  letterSpacing: '-0.02em',
  color: 'var(--mk-ink)',
};

function TierCta({ kind }: { kind: Tier['cta'] }) {
  if (kind === 'journeyman') {
    return (
      <BrassButton arrow={false} asChild>
        <Link href="#invitation">
          Request access
          <span
            className="italic leading-none"
            style={{ fontFamily: 'var(--font-display), serif', fontSize: 17 }}
          >
            →
          </span>
        </Link>
      </BrassButton>
    );
  }
  if (kind === 'foundry') {
    return (
      <GhostButton asChild>
        <a href="mailto:info@fairytalefactory.io">Talk to us</a>
      </GhostButton>
    );
  }
  return (
    <GhostButton asChild>
      <Link href="#invitation">Start free</Link>
    </GhostButton>
  );
}

export function PricingTeaser() {
  return (
    <SectionFrame id="pricing" number="06" kicker="Grades & Rates">
      {/* Heading + lede — 1 col mobile, 1fr / 1.6fr from 900px up */}
      <div className="mb-14 grid grid-cols-1 items-start gap-10 min-[900px]:grid-cols-[1fr_1.6fr] min-[900px]:gap-[72px]">
        <h2 style={H2_STYLE}>
          Three grades
          <br />
          <span style={{ fontStyle: 'italic', fontWeight: 300 }}>of operator.</span>
        </h2>
        <p
          className="m-0 max-w-[560px] text-[16px] leading-[1.65] [text-wrap:pretty]"
          style={{
            fontFamily: 'var(--font-body), system-ui, sans-serif',
            color: 'var(--mk-ink-2)',
          }}
        >
          Final rates are still being set. During the private beta, Tatara is free for solo
          use &mdash; bring your own model keys and work at your own pace.
        </p>
      </div>

      {/* Tier grid — stacks on mobile, 3 cols from 900px. Outer 1px rule. */}
      <div
        className="grid grid-cols-1 min-[900px]:grid-cols-3"
        style={{ border: '1px solid var(--mk-rule)' }}
      >
        {TIERS.map((t, i) => {
          const isLast = i === TIERS.length - 1;
          return (
            <div
              key={t.grade}
              className={[
                'relative flex flex-col px-8 py-10',
                // Horizontal divider between tiers when stacked (mobile).
                !isLast ? 'border-b border-[color:var(--mk-rule)]' : '',
                // On desktop: right divider between tiers, no bottom.
                !isLast
                  ? 'min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:border-[color:var(--mk-rule)]'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                background: t.featured ? 'var(--mk-paper-2)' : 'var(--mk-paper)',
              }}
            >
              {t.featured && (
                <div
                  aria-hidden
                  className="absolute left-0 right-0"
                  style={{
                    top: -1,
                    height: 4,
                    background: 'var(--mk-ember)',
                  }}
                />
              )}

              {/* Numbered kicker */}
              <div
                className="mb-[14px] text-[10px] uppercase tracking-[0.18em]"
                style={{
                  fontFamily: 'var(--font-mono), monospace',
                  color: t.featured ? 'var(--mk-ember)' : 'var(--mk-ink-3)',
                }}
              >
                № 0{i + 1} &middot; {t.tagline}
              </div>

              {/* Grade title */}
              <h3 style={GRADE_H3_STYLE}>{t.grade}</h3>

              {/* Divider + price row */}
              <div
                className="mt-6 flex items-baseline gap-[10px] pt-6"
                style={{ borderTop: '1px solid var(--mk-rule)' }}
              >
                <span style={PRICE_STYLE}>{t.price}</span>
                <span
                  className="text-[13px]"
                  style={{
                    fontFamily: 'var(--font-body), system-ui, sans-serif',
                    color: 'var(--mk-ink-3)',
                  }}
                >
                  {t.sub}
                </span>
              </div>

              {/* Feature list — dashed separators, italic brass em-dash bullets */}
              <ul className="mt-8 flex-1 list-none p-0">
                {t.items.map((it) => (
                  <li
                    key={it}
                    className="flex items-start gap-3 border-b border-dashed border-[color:var(--mk-rule)] py-[10px] text-[14px] leading-[1.5]"
                    style={{
                      fontFamily: 'var(--font-body), system-ui, sans-serif',
                      color: 'var(--mk-ink-2)',
                    }}
                  >
                    <span
                      aria-hidden
                      className="italic"
                      style={{
                        fontFamily: 'var(--font-display), serif',
                        color: 'var(--mk-brass)',
                        marginTop: -1,
                      }}
                    >
                      &mdash;
                    </span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <div className="mt-7">
                <TierCta kind={t.cta} />
              </div>
            </div>
          );
        })}
      </div>
    </SectionFrame>
  );
}

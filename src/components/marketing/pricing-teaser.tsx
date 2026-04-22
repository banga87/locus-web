// Section 06 — "Grades & Rates". Three-tier pricing grid: Apprentice,
// Journeyman, Foundry. Server Component.
//
// Layout notes:
// - Desktop (≥1024px, `lg:`): 3 equal columns. Featured (Journeyman) tier is
//   wrapped in <FrameCard/> which provides a brass top-rule signaling
//   "featured". Non-featured tiers render as plain cells with a 1px paper
//   rule border.
// - Mobile (<1024px): stacks to 1 column.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FrameCard } from '@/components/tatara';
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

function TierCta({ kind }: { kind: Tier['cta'] }) {
  if (kind === 'journeyman') {
    return (
      <Button asChild variant="accent" size="lg">
        <Link href="#invitation">Request access</Link>
      </Button>
    );
  }
  if (kind === 'foundry') {
    return (
      <Button asChild variant="ghost" size="lg">
        <a href="mailto:info@fairytalefactory.io">Talk to us</a>
      </Button>
    );
  }
  return (
    <Button asChild variant="ghost" size="lg">
      <Link href="#invitation">Start free</Link>
    </Button>
  );
}

function TierBody({ tier, index }: { tier: Tier; index: number }) {
  return (
    <div className="flex flex-col">
      {/* Numbered kicker */}
      <div
        className="t-mono-label"
        style={{ color: tier.featured ? 'var(--ember)' : 'var(--ink-3)' }}
      >
        № 0{index + 1} &middot; {tier.tagline}
      </div>

      {/* Grade title */}
      <h3 className="t-h3 mt-4">{tier.grade}</h3>

      {/* Divider + price row */}
      <div
        className="mt-6 flex items-baseline gap-[10px] pt-6"
        style={{ borderTop: '1px solid var(--paper-rule)' }}
      >
        <span
          className="text-[clamp(32px,8vw,44px)]"
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 500,
            lineHeight: 1,
            color: 'var(--ink-1)',
          }}
        >
          {tier.price}
        </span>
        <span className="t-body-sm" style={{ color: 'var(--ink-3)' }}>
          {tier.sub}
        </span>
      </div>

      {/* Feature list — dashed separators, italic brass em-dash bullets */}
      <ul className="mt-8 flex-1 list-none p-0">
        {tier.items.map((it) => (
          <li
            key={it}
            className="flex items-start gap-3 border-b border-dashed py-[10px] text-[14px] leading-[1.5]"
            style={{
              borderBottomColor: 'var(--paper-rule)',
              color: 'var(--ink-2)',
            }}
          >
            <span
              aria-hidden
              className="italic"
              style={{
                fontFamily: 'var(--font-display)',
                color: 'var(--brass)',
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
        <TierCta kind={tier.cta} />
      </div>
    </div>
  );
}

export function PricingTeaser() {
  return (
    <SectionFrame id="pricing" number="07" kicker="Grades & Rates">
      {/* Heading + lede — 1 col mobile, 1fr / 1.6fr from `lg:` up */}
      <div className="mb-14 grid grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-[72px]">
        <h2 className="t-h2">
          Three grades
          <br />
          <span style={{ fontStyle: 'italic', fontWeight: 300 }}>of operator.</span>
        </h2>
        <p className="t-body max-w-[560px] [text-wrap:pretty]">
          Final rates are still being set. During the private beta, Tatara is free for solo use.
          Bring your own model keys and work at your own pace.
        </p>
      </div>

      {/* Tier grid — stacks on mobile, 3 cols from `lg:`. Featured tier wraps
          in <FrameCard/> for the brass top-rule; non-featured tiers are plain
          cells on cream. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
        {TIERS.map((t, i) => {
          if (t.featured) {
            return (
              <FrameCard key={t.grade} className="px-8 py-10">
                <TierBody tier={t} index={i} />
              </FrameCard>
            );
          }
          return (
            <div
              key={t.grade}
              className="px-8 py-10"
              style={{ border: '1px solid var(--paper-rule)' }}
            >
              <TierBody tier={t} index={i} />
            </div>
          );
        })}
      </div>
    </SectionFrame>
  );
}

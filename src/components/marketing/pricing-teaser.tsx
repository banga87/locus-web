// Section 07 — "Grades & Rates". Three-tier pricing grid: Apprentice,
// Journeyman, Foundry. Server Component with one client island for the
// Journeyman credit ladder.
//
// Layout notes:
// - Desktop (≥1024px, `lg:`): 1fr / 1.5fr / 1fr — Journeyman dominates so the
//   single paid tier reads as the hero. Wrapped in <FrameCard/> for the brass
//   top-rule. Outer tiles use a plain paper-rule border.
// - Mobile (<1024px): stacks to 1 column, Journeyman still wears FrameCard.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FrameCard } from '@/components/tatara';
import { SectionFrame } from '@/components/marketing/section-frame';
import { JourneymanLadder } from '@/components/marketing/journeyman-ladder';

interface Tier {
  grade: string;
  tagline: string;
  price: string;
  sub: string;
  items: readonly string[];
  cta: 'apprentice' | 'foundry';
}

const APPRENTICE: Tier = {
  grade: 'Apprentice',
  tagline: 'For solo operators.',
  price: 'Free',
  sub: 'during beta',
  items: [
    '500 credits every month',
    'Card on file required',
    'One workspace',
    'Upgrade any time',
  ],
  cta: 'apprentice',
};

const FOUNDRY: Tier = {
  grade: 'Foundry',
  tagline: 'For teams that forge at scale.',
  price: 'Talk',
  sub: 'with us',
  items: [
    'Everything in Journeyman',
    'Self-hosted or VPC deploy',
    'SSO, SCIM, audit export',
    'Dedicated support',
    'Named operator on our side',
  ],
  cta: 'foundry',
};

const JOURNEYMAN_ITEMS: readonly string[] = [
  'Everything in Apprentice',
  'Unlimited seats per workspace',
  'Audit trail + run history',
  'Priority support',
];

function TierCta({ kind }: { kind: Tier['cta'] }) {
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

function TierKicker({ index, tagline, featured }: { index: number; tagline: string; featured?: boolean }) {
  return (
    <div
      className="t-mono-label"
      style={{ color: featured ? 'var(--ember)' : 'var(--ink-3)' }}
    >
      № 0{index + 1} &middot; {tagline}
    </div>
  );
}

function PriceRow({ price, sub }: { price: string; sub: string }) {
  return (
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
        {price}
      </span>
      <span className="t-body-sm" style={{ color: 'var(--ink-3)' }}>
        {sub}
      </span>
    </div>
  );
}

function FeatureList({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-8 flex-1 list-none p-0">
      {items.map((it) => (
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
  );
}

function OuterTier({ tier, index }: { tier: Tier; index: number }) {
  return (
    <div
      className="flex flex-col px-8 py-10"
      style={{ border: '1px solid var(--paper-rule)' }}
    >
      <TierKicker index={index} tagline={tier.tagline} />
      <h3 className="t-h3 mt-4">{tier.grade}</h3>
      <PriceRow price={tier.price} sub={tier.sub} />
      <FeatureList items={tier.items} />
      <div className="mt-7">
        <TierCta kind={tier.cta} />
      </div>
    </div>
  );
}

function JourneymanTier() {
  return (
    <FrameCard className="flex flex-col px-10 py-12">
      <TierKicker index={1} tagline="For small workshops." featured />
      <h3 className="t-h3 mt-4">Journeyman</h3>

      {/* Price + ladder — the ladder swaps the displayed number. */}
      <JourneymanLadder />

      <FeatureList items={JOURNEYMAN_ITEMS} />

      <p
        className="mt-5 text-[13px] leading-[1.5]"
        style={{ color: 'var(--ink-3)' }}
      >
        Top up any time &mdash; from <span style={{ color: 'var(--ink-2)' }}>$15 per 1,000 credits</span>.
      </p>

      <div className="mt-7">
        <Button asChild variant="accent" size="lg">
          <Link href="#invitation">Request access</Link>
        </Button>
      </div>
    </FrameCard>
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
          Pay a monthly subscription, get a bucket of credits, top up when you need more.
          Credits cover everything the platform does for you &mdash; no metered surprises,
          no pricing spreadsheet.
        </p>
      </div>

      {/* Tier grid — stacks on mobile, 1fr / 1.5fr / 1fr from `lg:` so the
          single paid tier (Journeyman) is visually dominant. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.5fr_1fr] lg:items-start">
        <OuterTier tier={APPRENTICE} index={0} />
        <JourneymanTier />
        <OuterTier tier={FOUNDRY} index={2} />
      </div>
    </SectionFrame>
  );
}

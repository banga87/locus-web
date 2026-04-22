// Section 03 — "The Console". Six numbered feature tiles on the dark-inverse
// surface provided by SectionFrame dark. Server Component. Uses Tatara
// FrameCard (inverse) for each tile and T-scale classes for typography.

import { SectionFrame } from '@/components/marketing/section-frame';
import { FrameCard } from '@/components/tatara';

interface Item {
  n: string;
  title: string;
  body: string;
}

const ITEMS: readonly Item[] = [
  {
    n: '01',
    title: 'Always-current knowledge.',
    body: "As your systems change, Tatara updates itself. Your agents never work from yesterday's information.",
  },
  {
    n: '02',
    title: 'Every answer traceable.',
    body: 'Every agent response points back to where the knowledge came from. No more confidently wrong answers in front of your customers.',
  },
  {
    n: '03',
    title: 'Works with any agent.',
    body: 'Tatara sits beneath whatever framework your team is using now, and whichever one you move to next.',
  },
  {
    n: '04',
    title: 'Full version history.',
    body: "Every change and every update is recorded and recoverable. Roll back your business's knowledge to any point, the way you'd roll back a change in any serious system.",
  },
  {
    n: '05',
    title: 'Token-efficient by design.',
    body: 'Tatara hands your agents only the context they need for the job in front of them, not your whole business. Costs stay predictable as you scale.',
  },
  {
    n: '06',
    title: 'Your knowledge, your control.',
    body: 'Your operating knowledge lives in open formats you can export and audit any time. No vendor lock-in. No black box. No hostage data.',
  },
];

export function Features() {
  return (
    <SectionFrame id="product" number="04" kicker="The Console" dark>
      {/* Heading + lede */}
      <div className="mb-14 grid grid-cols-1 items-end gap-10 lg:grid-cols-2 lg:gap-[72px]">
        <h2 className="t-h2" style={{ color: 'var(--ink-inverse)' }}>
          What sits
          <br />
          <span className="italic" style={{ color: 'var(--brass-soft)' }}>
            under your agents.
          </span>
        </h2>
        <p className="t-body" style={{ color: 'var(--ink-inverse-2)' }}>
          A short catalogue of what Tatara gives you. Nothing hidden, nothing magical. Just the
          controls and guarantees you&rsquo;d expect under a system you&rsquo;re going to trust.
        </p>
      </div>

      {/* Tile grid — FrameCard provides its own border + brass top rule. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
        {ITEMS.map((it) => (
          <FrameCard key={it.n} variant="inverse">
            <div className="t-mono-label" style={{ color: 'var(--brass-soft)' }}>
              № {it.n}
            </div>
            <h3 className="t-h3 mt-3" style={{ color: 'var(--ink-inverse)' }}>
              {it.title}
            </h3>
            <p className="t-body mt-2" style={{ color: 'var(--ink-inverse-2)' }}>
              {it.body}
            </p>
          </FrameCard>
        ))}
      </div>
    </SectionFrame>
  );
}

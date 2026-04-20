// Section 02 — "How it works". Three stages (Anneal / Temper / Stoke) laid
// out as three columns (rows on mobile), each a short Eyebrow-led block of
// body copy. Server Component.
//
// Task 5.5: the big <h2> now lives inside SectionFrame (via Tatara's
// <SectionHeader>), so this file only owns the three stage columns and
// their copy.

import { SectionFrame } from '@/components/marketing/section-frame';
import { Eyebrow } from '@/components/tatara';

interface Stage {
  n: string;
  stage: string;
  title: string;
  body: string;
}

const STAGES: readonly Stage[] = [
  {
    n: '01',
    stage: 'ANNEAL',
    title: 'Anneal the raw material.',
    body: 'Pour in plain markdown. Your documents live on your filesystem, versioned like code — no proprietary format, no lock-in.',
  },
  {
    n: '02',
    stage: 'TEMPER',
    title: 'Temper under heat.',
    body: 'Hire an operator — researcher, drafter, reviewer — and hand it a document. Throttle the tokens, watch the gauges, stop it any time.',
  },
  {
    n: '03',
    stage: 'STOKE',
    title: 'Stoke what it returns.',
    body: 'Every edit is a diff. Every run is versioned. Every tool call is logged. Accept, amend, or discard.',
  },
];

export function HowItWorks() {
  return (
    <SectionFrame
      id="how-it-works"
      number="02"
      kicker="HOW IT WORKS"
      title="Three stages, one fire kept lit."
    >
      <div className="grid grid-cols-1 gap-10 min-[900px]:grid-cols-3 min-[900px]:gap-12">
        {STAGES.map((s) => (
          <div key={s.n} className="flex flex-col gap-4">
            <Eyebrow number={s.n}>{s.stage}</Eyebrow>
            <h3 className="t-h3">{s.title}</h3>
            <p className="t-body">{s.body}</p>
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}

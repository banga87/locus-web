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
    stage: 'STOKE',
    title: 'Connect your systems.',
    body: 'Plug in your CRM, your inbox, your sales funnel, your SOPs, whatever runs the business. Tatara reads from each, automatically. No spreadsheet kept in sync by hand.',
  },
  {
    n: '02',
    stage: 'TEMPER',
    title: 'Tatara keeps it current.',
    body: 'As your business changes, Tatara notices. New deal, new policy, new launch. The operating knowledge your agents rely on updates itself. No stale information, no drift, no one chasing a document trail.',
  },
  {
    n: '03',
    stage: 'ANNEAL',
    title: 'Your agents run on real context.',
    body: 'Whatever agent framework your team uses, it reads from Tatara. Your AI now answers from the same picture you do, with sources you can trace and a knowledge base that never goes cold.',
  },
];

export function HowItWorks() {
  return (
    <SectionFrame
      id="how-it-works"
      number="03"
      kicker="HOW IT RUNS"
      title="Three stages, one fire kept lit."
    >
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3 lg:gap-12">
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

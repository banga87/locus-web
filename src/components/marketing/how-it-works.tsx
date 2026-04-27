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
    title: 'Every agent contributes.',
    body: 'Any agent that speaks MCP pushes findings, decisions, and artifacts into the brain — Claude Code, Claude Desktop, ChatGPT, Codex, or one your team built. No new tool to learn.',
  },
  {
    n: '02',
    stage: 'TEMPER',
    title: 'The brain maintains itself.',
    body: 'A Maintenance Agent reviews every write: validates structure, kills duplicates, classifies, traces sources. The brain stays clean as it grows.',
  },
  {
    n: '03',
    stage: 'ANNEAL',
    title: 'You approve the edge cases.',
    body: 'A small inbox surfaces only the writes that need human judgement. Everything else flows automatically.',
  },
];

export function HowItWorks() {
  return (
    <SectionFrame
      id="how-it-works"
      number="02"
      kicker="HOW IT WORKS"
      title="Every agent. One brain. No black holes."
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

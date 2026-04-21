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
    title: 'Every run, a diff.',
    body: 'Agent output lands as a proposed change — never a silent overwrite. Accept, amend, or discard. Your history is intact.',
  },
  {
    n: '02',
    title: 'Markdown, your way.',
    body: 'Tatara reads and writes plain markdown on your filesystem. Obsidian-compatible. Works with your existing git workflow.',
  },
  {
    n: '03',
    title: 'Gauges, not black boxes.',
    body: 'Token spend, tool calls, and context windows visible at all times. Nothing hidden behind a loading spinner.',
  },
  {
    n: '04',
    title: 'Throttles and stops.',
    body: 'Halt a run mid-stream. Lower the temperature. Restrict tool access. The controls are real, not cosmetic.',
  },
  {
    n: '05',
    title: 'Model-agnostic.',
    body: 'Claude, GPT, Gemini, or a local model on your own metal. Swap mid-run. No vendor lock-in designed into the product.',
  },
  {
    n: '06',
    title: 'Built for keeping.',
    body: 'Documents are files, not rows in a database. Export is a no-op — everything you see is already on disk, where it belongs.',
  },
];

export function Features() {
  return (
    <SectionFrame id="product" number="03" kicker="The Console" dark>
      {/* Heading + lede */}
      <div className="mb-14 grid grid-cols-1 items-end gap-10 lg:grid-cols-2 lg:gap-[72px]">
        <h2 className="t-h2" style={{ color: 'var(--ink-inverse)' }}>
          What the operator
          <br />
          <span className="italic" style={{ color: 'var(--brass-soft)' }}>
            has at hand.
          </span>
        </h2>
        <p className="t-body" style={{ color: 'var(--ink-inverse-2)' }}>
          A short catalogue of the controls. Nothing magical, nothing mystic — just the affordances{/* tatara:allow-banned */}
          you expect when you&rsquo;re the one running the machine.
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

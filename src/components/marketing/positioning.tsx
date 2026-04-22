// Section 04 — "A Position". Two-column comparison ledger: "Elsewhere" vs
// "At Tatara". Server Component.
//
// Layout choice: nested grids (not a real <table>). Rationale: this is
// visual editorial content — a ledger styled to look like a typeset
// comparison — not tabular data a screen reader user would navigate as
// a table. The two columns are paired items, not rows of data.

import { SectionFrame } from '@/components/marketing/section-frame';
import { Eyebrow } from '@/components/tatara';

const ROWS: readonly [string, string][] = [
  ['“Let AI run your business.”', 'Keep your agents in your control.'],
  ["Agents working from yesterday's information.", 'Always-current operating knowledge.'],
  ['Confidently wrong answers in front of customers.', 'Every answer traceable to a source.'],
  ['Manual updates across five systems.', 'One place, automatically kept in sync.'],
  ['A different prompt library on every laptop.', 'One shared context your whole team works from.'],
  ['A chat interface.', 'A console.'],
];

export function Positioning() {
  return (
    <SectionFrame id="position" number="05" kicker="A Position">
      <div className="grid grid-cols-1 items-start gap-10">
        {/* Preamble — anti-autopilot stance, kept brief above the ledger. tatara:allow-banned */}
        <div className="max-w-[760px]">
          <h2 className="t-h2">
            We are not building{' '}
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontWeight: 300,
              }}
            >
              an autopilot.{/* tatara:allow-banned */}
            </span>
          </h2>
          <p
            className="t-body mt-5 [text-wrap:pretty]"
            style={{ color: 'var(--ink-2)' }}
          >
            Most of the AI market sells autonomy: the promise of a business that runs itself. The
            ops leads we talk to don&rsquo;t want that. They want leverage: a way to point their
            agents at the work that matters and see, at a glance, that the agents are working from
            current facts.
          </p>
          <p
            className="mt-5 max-w-[520px] [text-wrap:pretty]"
            style={{
              fontFamily: 'var(--font-display), serif',
              fontStyle: 'italic',
              fontWeight: 300,
              fontSize: 20,
              lineHeight: 1.4,
              color: 'var(--brass)',
            }}
          >
            Tatara sells control, current context, and the dignity of running your own machine.
          </p>
        </div>

        {/* Ledger plate — cream-soft card with paper-rule hairline border.
            Nested grids for header row + data rows. */}
        <div className="paper-scope bg-[var(--cream-soft)] border border-[var(--paper-rule)]">
          {/* Header row */}
          <div className="grid grid-cols-2 border-b border-[var(--paper-rule)]">
            <div className="px-6 py-4 border-r border-[var(--paper-rule)]">
              <Eyebrow>ELSEWHERE</Eyebrow>
            </div>
            <div className="px-6 py-4">
              <Eyebrow>AT TATARA</Eyebrow>
            </div>
          </div>

          {ROWS.map(([a, b], i) => (
            <div
              key={i}
              className={`grid grid-cols-2 ${i > 0 ? 'border-t border-[var(--paper-rule)]' : ''}`}
            >
              <div className="px-6 py-4 border-r border-[var(--paper-rule)]">
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontStyle: 'italic',
                    fontWeight: 300,
                    textDecoration: 'line-through',
                    textDecorationColor: 'var(--brass)',
                    textDecorationThickness: '1px',
                    color: 'var(--ink-3)',
                  }}
                >
                  {a}
                </span>
              </div>
              <div className="px-6 py-4">
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 500,
                    color: 'var(--ink-1)',
                  }}
                >
                  {b}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionFrame>
  );
}

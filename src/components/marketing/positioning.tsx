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
  ['“Let AI run your business.”', 'Stay on the controls of your own work.'],
  ['Hands-free. Set it and forget it.', 'Hands-on. Feel every turn of the crank.'],
  ['Black box agents.', 'Visible gauges, legible state.'],
  ['Data locked in the vendor.', 'Plain markdown, on your disk.'],
  ['Unexpected charges.', 'Token meter always in view.'],
  ['A chat interface.', 'A console.'],
];

export function Positioning() {
  return (
    <SectionFrame id="position" number="04" kicker="A Position">
      <div className="grid grid-cols-1 items-start gap-10">
        {/* Preamble — anti-autopilot stance, kept brief above the ledger. */}
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
              an autopilot.
            </span>
          </h2>
          <p
            className="t-body mt-5 [text-wrap:pretty]"
            style={{ color: 'var(--ink-2)' }}
          >
            The rest of the market is quietly terrified of full autonomy. They don&rsquo;t want
            abandonment; they want control. They want to see what the machine is doing, throttle
            it when it runs hot, and pull the lever themselves.
          </p>
        </div>

        {/* Ledger plate — cream-soft card with paper-rule hairline border.
            Nested grids for header row + data rows. */}
        <div className="bg-[var(--cream-soft)] border border-[var(--paper-rule)]">
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

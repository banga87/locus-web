// Section 04 — "A Position". Two-column comparison ledger: "Elsewhere" vs
// "At Tatara". Server Component. Ported from Tatara/components/Sections.jsx
// lines 215–298.
//
// Layout choice: nested grids (not a real <table>). Rationale: this is
// visual editorial content — a ledger styled to look like a typeset
// comparison — not tabular data a screen reader user would navigate as
// a table. Matching the Tatara prototype's nested-grid structure keeps
// the port faithful and avoids <table> semantics that would mis-announce
// the intent. The two columns are paired items, not rows of data.

import type { CSSProperties } from 'react';
import { SectionFrame } from '@/components/marketing/section-frame';

const ROWS: readonly [string, string][] = [
  ['“Let AI run your business.”', 'Stay on the controls of your own work.'],
  ['Hands-free. Set it and forget it.', 'Hands-on. Feel every turn of the crank.'],
  ['Black box agents.', 'Visible gauges, legible state.'],
  ['Data locked in the vendor.', 'Plain markdown, on your disk.'],
  ['Unexpected charges.', 'Token meter always in view.'],
  ['A chat interface.', 'A console.'],
];

const H2_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 400,
  fontSize: 'clamp(40px, 4.2vw, 64px)',
  lineHeight: 1.02,
  letterSpacing: '-0.02em',
  margin: 0,
  fontVariationSettings: '"SOFT" 40, "opsz" 144',
};

const COLUMN_HEADER_BASE =
  'px-7 py-[18px] text-[10px] uppercase tracking-[0.18em]';

const CELL_LEFT_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontStyle: 'italic',
  fontWeight: 300,
  fontSize: 17,
  color: 'var(--mk-ink-3)',
  lineHeight: 1.4,
  textDecoration: 'line-through',
  textDecorationColor: 'var(--mk-brass)',
  textDecorationThickness: '1px',
};

const CELL_RIGHT_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 400,
  fontSize: 17,
  color: 'var(--mk-ink)',
  lineHeight: 1.4,
};

export function Positioning() {
  return (
    <SectionFrame id="position" number="04" kicker="A Position">
      <div className="grid grid-cols-1 items-start gap-14 min-[900px]:grid-cols-[1fr_1.4fr] min-[900px]:gap-[72px]">
        {/* Left column — anti-autopilot stance */}
        <div>
          <h2 style={H2_STYLE}>
            We are not building
            <br />
            <span style={{ fontStyle: 'italic', fontWeight: 300 }}>an autopilot.</span>
          </h2>
          <p
            className="mt-6 max-w-[420px] text-[16px] leading-[1.65] [text-wrap:pretty]"
            style={{
              fontFamily: 'var(--font-body), system-ui, sans-serif',
              color: 'var(--mk-ink-2)',
            }}
          >
            The rest of the market is quietly terrified of full autonomy. They don&rsquo;t want
            abandonment; they want leverage. They want to see what the machine is doing, throttle
            it when it runs hot, and pull the lever themselves.
          </p>
          <p
            className="mt-5 max-w-[420px] text-[20px] leading-[1.4]"
            style={{
              fontFamily: 'var(--font-display), serif',
              fontStyle: 'italic',
              fontWeight: 300,
              color: '#8B4A1F',
            }}
          >
            Tatara sells control, visibility, and the dignity of operating your own machine.
          </p>
        </div>

        {/* Right column — comparison ledger. Paper-2 background plate with a
            hairline border; nested grids for header row + six data rows. */}
        <div
          style={{
            background: 'var(--mk-paper-2)',
            border: '1px solid var(--mk-rule)',
          }}
        >
          {/* Header row */}
          <div
            className="grid grid-cols-2"
            style={{ borderBottom: '1px solid var(--mk-rule)' }}
          >
            <div
              className={COLUMN_HEADER_BASE}
              style={{
                borderRight: '1px solid var(--mk-rule)',
                fontFamily: 'var(--font-mono), monospace',
                color: 'var(--mk-ink-3)',
              }}
            >
              Elsewhere
            </div>
            <div
              className={COLUMN_HEADER_BASE}
              style={{
                fontFamily: 'var(--font-mono), monospace',
                color: 'var(--mk-ember)',
              }}
            >
              At Tatara
            </div>
          </div>

          {ROWS.map(([a, b], i) => {
            const isLast = i === ROWS.length - 1;
            return (
              <div
                key={i}
                className="grid grid-cols-2"
                style={{
                  borderBottom: !isLast ? '1px solid var(--mk-rule)' : 'none',
                }}
              >
                <div
                  className="px-7 py-5"
                  style={{
                    borderRight: '1px solid var(--mk-rule)',
                    ...CELL_LEFT_STYLE,
                  }}
                >
                  {a}
                </div>
                <div className="px-7 py-5" style={CELL_RIGHT_STYLE}>
                  {b}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SectionFrame>
  );
}

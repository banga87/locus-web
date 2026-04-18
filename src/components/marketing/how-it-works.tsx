// Section 02 — "How it runs". Three stages (Stoke / Temper / Anneal) with a
// placeholder exhibit in the left column and a numbered ledger on the right.
// Server Component. Ported from Tatara/components/Sections.jsx lines 20–118.

import type { CSSProperties } from 'react';
import { Placeholder } from '@/components/marketing/primitives';
import { SectionFrame } from '@/components/marketing/section-frame';

interface Stage {
  n: string;
  stage: string;
  title: string;
  body: string;
  spec: string;
}

const STAGES: readonly Stage[] = [
  {
    n: 'I',
    stage: 'Stoke',
    title: 'Write your thinking.',
    body: 'Plain markdown. No proprietary format, no lock-in. Your documents live on your filesystem, versioned like code. Tatara renders them like Notion — without asking for the keys.',
    spec: 'md · git · obsidian-compatible',
  },
  {
    n: 'II',
    stage: 'Temper',
    title: 'Hire an agent.',
    body: 'Pick an operator — a researcher, a drafter, a reviewer — and hand it a document. Set the scope. Throttle the tokens. Watch the gauges. Stop it at any time; the state is yours.',
    spec: 'claude · gpt · gemini · local',
  },
  {
    n: 'III',
    stage: 'Anneal',
    title: 'Read what it did.',
    body: 'Every edit is a diff. Every run is versioned. Every tool call is logged. Accept the changes, amend them, or discard the run. The machine never commits behind your back.',
    spec: 'diff · revert · branch · merge',
  },
];

// Variable-axis display heading. SOFT 40 + opsz 144 match the marketing
// h1 treatment established by Hero.
const H2_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 400,
  fontSize: 'clamp(44px, 5vw, 76px)',
  lineHeight: 1.0,
  letterSpacing: '-0.02em',
  margin: 0,
  fontVariationSettings: '"SOFT" 40, "opsz" 144',
};

export function HowItWorks() {
  return (
    <SectionFrame id="how-it-works" number="02" kicker="How it runs">
      <div className="grid grid-cols-1 items-start gap-14 min-[900px]:grid-cols-2 min-[900px]:gap-[72px]">
        {/* Left column — heading, lede, exhibit placeholder */}
        <div>
          <h2 style={H2_STYLE}>
            Three stages,
            <br />
            <span style={{ fontStyle: 'italic', fontWeight: 300 }}>one fire kept lit.</span>
          </h2>
          <p
            className="mt-6 max-w-[460px] text-[17px] leading-[1.6] [text-wrap:pretty]"
            style={{
              fontFamily: 'var(--font-body), system-ui, sans-serif',
              color: 'var(--mk-ink-2)',
            }}
          >
            Tatara borrows its rhythm from the traditional furnace: raw material goes in cold, work
            is done under watchful heat, and what comes out is finished, legible, and yours.
          </p>

          <div className="mt-10">
            <Placeholder
              label="Pl. 02 — Close-up of gauge bank, hands on lever"
              height={280}
            />
          </div>
        </div>

        {/* Right column — numbered stages ledger */}
        <div>
          {STAGES.map((s, i) => {
            const isFirst = i === 0;
            const isLast = i === STAGES.length - 1;
            return (
              <div
                key={s.n}
                className="grid grid-cols-[80px_1fr] gap-6 py-8"
                style={{
                  borderTop: isFirst ? '1px solid var(--mk-rule)' : 'none',
                  borderBottom: !isLast ? '1px solid var(--mk-rule)' : 'none',
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display), serif',
                      fontStyle: 'italic',
                      fontWeight: 300,
                      fontSize: 48,
                      lineHeight: 1,
                      color: 'var(--mk-brass)',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {s.n}
                  </div>
                  <div
                    className="mt-2 text-[10px] uppercase tracking-[0.16em]"
                    style={{
                      fontFamily: 'var(--font-mono), monospace',
                      color: 'var(--mk-ember)',
                    }}
                  >
                    {s.stage}
                  </div>
                </div>
                <div>
                  <h3
                    style={{
                      fontFamily: 'var(--font-display), serif',
                      fontWeight: 500,
                      fontSize: 26,
                      lineHeight: 1.2,
                      letterSpacing: '-0.015em',
                      margin: 0,
                    }}
                  >
                    {s.title}
                  </h3>
                  <p
                    className="mt-[10px] text-[15.5px] leading-[1.6] [text-wrap:pretty]"
                    style={{
                      fontFamily: 'var(--font-body), system-ui, sans-serif',
                      color: 'var(--mk-ink-2)',
                      margin: '10px 0 0',
                    }}
                  >
                    {s.body}
                  </p>
                  <div
                    className="mt-[14px] text-[11px] tracking-[0.1em]"
                    style={{
                      fontFamily: 'var(--font-mono), monospace',
                      color: 'var(--mk-ink-3)',
                    }}
                  >
                    {s.spec}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SectionFrame>
  );
}

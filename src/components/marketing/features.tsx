// Section 03 — "The Console". Six numbered feature tiles on a dark (ink)
// background. Server Component. Ported from Tatara/components/Sections.jsx
// lines 121–212.

import type { CSSProperties } from 'react';
import { SectionFrame } from '@/components/marketing/section-frame';

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

const H2_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 300,
  fontSize: 'clamp(44px, 5vw, 76px)',
  lineHeight: 1.02,
  letterSpacing: '-0.02em',
  margin: 0,
  color: 'var(--mk-paper)',
  fontVariationSettings: '"SOFT" 40, "opsz" 144',
};

const TILE_H3_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontWeight: 400,
  fontSize: 28,
  lineHeight: 1.1,
  letterSpacing: '-0.015em',
  margin: 0,
  color: 'var(--mk-paper)',
  fontVariationSettings: '"SOFT" 40',
};

export function Features() {
  return (
    <SectionFrame id="product" number="03" kicker="The Console" dark>
      {/* Heading + lede */}
      <div className="mb-14 grid grid-cols-1 items-end gap-10 min-[900px]:grid-cols-2 min-[900px]:gap-[72px]">
        <h2 style={H2_STYLE}>
          What the operator
          <br />
          <span style={{ fontStyle: 'italic', color: 'var(--mk-gold)' }}>has at hand.</span>
        </h2>
        <p
          className="m-0 max-w-[420px] text-[17px] leading-[1.6] [text-wrap:pretty]"
          style={{
            fontFamily: 'var(--font-body), system-ui, sans-serif',
            color: 'var(--mk-paper-dim)',
          }}
        >
          A short catalogue of the controls. Nothing magical, nothing mystic — just the affordances
          you expect when you&rsquo;re the one running the machine.
        </p>
      </div>

      {/* Tile grid — 1 col mobile, 2 at 640px, 3 from 900px up. Dividers
          must only appear *between* tiles at each breakpoint, so we use
          arbitrary-variant selectors tied to nth-child + breakpoint to
          disable right/bottom borders on edge tiles per grid configuration. */}
      <div
        className="grid grid-cols-1 min-[640px]:grid-cols-2 min-[900px]:grid-cols-3"
        style={{ borderTop: '1px solid var(--mk-rule-dark)' }}
      >
        {ITEMS.map((it) => (
          <div
            key={it.n}
            className="
              relative px-7 pb-10 pt-9
              border-b border-[color:var(--mk-rule-dark)]
              [&:last-child]:border-b-0
              min-[640px]:max-[899px]:[&:nth-child(odd)]:border-r
              min-[640px]:[&:nth-last-child(-n+2)]:border-b-0
              min-[900px]:[&:not(:nth-child(3n))]:border-r
              min-[900px]:[&:nth-last-child(-n+3)]:border-b-0
            "
          >
            <div
              className="mb-4 text-[11px] tracking-[0.16em]"
              style={{
                fontFamily: 'var(--font-mono), monospace',
                color: 'var(--mk-gold)',
              }}
            >
              № {it.n}
            </div>
            <h3 style={TILE_H3_STYLE}>{it.title}</h3>
            <p
              className="mt-[14px] text-[15px] leading-[1.6] [text-wrap:pretty]"
              style={{
                fontFamily: 'var(--font-body), system-ui, sans-serif',
                color: 'var(--mk-paper-dim)',
                margin: '14px 0 0',
              }}
            >
              {it.body}
            </p>
          </div>
        ))}
      </div>
    </SectionFrame>
  );
}

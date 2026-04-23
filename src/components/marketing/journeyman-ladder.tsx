'use client';

// Interactive price/credit selector for the Journeyman tier. Four steps from
// the Journeyman ladder in `project_pricing_tbd.md`. Default = base rate.
//
// Visual grammar matches the surrounding PriceRow: EB Garamond italic for the
// dollar figure, humanist sans for everything else. The segmented control
// sits under the price row and swaps the displayed numbers in place.

import { useState } from 'react';

interface Rung {
  credits: number;
  price: number;
  label: string; // short form for the segment pill
  tag?: string; // optional "5% off" etc.
}

const LADDER: readonly Rung[] = [
  { credits: 2000, price: 29, label: '2K' },
  { credits: 4000, price: 55, label: '4K', tag: '5% off' },
  { credits: 8000, price: 105, label: '8K', tag: '9% off' },
  { credits: 15000, price: 190, label: '15K', tag: '13% off' },
];

function formatCredits(n: number) {
  return n.toLocaleString('en-US');
}

export function JourneymanLadder() {
  const [idx, setIdx] = useState(0);
  const active = LADDER[idx];

  return (
    <div>
      {/* Price row — same shape as the static PriceRow in the outer tiers */}
      <div
        className="mt-6 flex items-baseline gap-[10px] pt-6"
        style={{ borderTop: '1px solid var(--paper-rule)' }}
      >
        <span
          className="text-[clamp(36px,9vw,52px)]"
          style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 500,
            lineHeight: 1,
            color: 'var(--ink-1)',
          }}
        >
          ${active.price}
        </span>
        <span className="t-body-sm" style={{ color: 'var(--ink-3)' }}>
          / month &middot; {formatCredits(active.credits)} credits
        </span>
      </div>

      {/* Segmented control */}
      <div
        role="radiogroup"
        aria-label="Choose monthly credits"
        className="mt-5 grid grid-cols-4 gap-0"
        style={{ border: '1px solid var(--paper-rule)' }}
      >
        {LADDER.map((rung, i) => {
          const selected = i === idx;
          return (
            <button
              key={rung.credits}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setIdx(i)}
              className="t-mono-label relative py-3 text-center transition-colors duration-[120ms]"
              style={{
                background: selected ? 'var(--ink-1)' : 'transparent',
                color: selected ? 'var(--cream)' : 'var(--ink-2)',
                borderLeft: i === 0 ? 'none' : '1px solid var(--paper-rule)',
                cursor: selected ? 'default' : 'pointer',
              }}
            >
              {rung.label}
            </button>
          );
        })}
      </div>

      {/* Discount tag — reserves the line height to prevent reflow */}
      <p
        className="mt-2 text-[12px] leading-[1.4] min-h-[16px]"
        style={{ color: 'var(--ember)' }}
        aria-live="polite"
      >
        {active.tag ?? ''}
      </p>
    </div>
  );
}

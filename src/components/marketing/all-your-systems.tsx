// Section 03 — "Across the business". The breadth-of-coverage promise:
// every department of your business has a place in the brain. Two-column
// layout: headline + body + manifesto line on the left, a letterpress
// department plate on the right. Server Component.

import { SectionFrame } from '@/components/marketing/section-frame';

interface Department {
  name: string;
  descriptor: string;
}

const DEPARTMENTS: readonly Department[] = [
  { name: 'Sales', descriptor: 'conversations, deals, pipeline.' },
  { name: 'Marketing', descriptor: 'campaigns, positioning, copy.' },
  { name: 'Product', descriptor: 'roadmap, research, decisions.' },
  { name: 'Operations', descriptor: 'runbooks, vendors, policy.' },
  { name: 'Engineering', descriptor: 'architecture, releases, incidents.' },
  { name: 'Customer success', descriptor: 'accounts, feedback, support.' },
  { name: 'Finance', descriptor: 'budget, contracts, expenses.' },
  { name: 'Strategy', descriptor: 'OKRs, goals, planning.' },
];

export function AllYourSystems() {
  return (
    <SectionFrame id="across-the-business" number="03" kicker="Across the Business">
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-[72px]">
        {/* Left column — headline, lede, manifesto line. */}
        <div>
          <h2 className="t-h2">
            A place for{' '}
            <span style={{ fontStyle: 'italic', fontWeight: 300 }}>every part of your business.</span>
          </h2>
          <p className="t-body mt-6 max-w-[460px] [text-wrap:pretty]" style={{ color: 'var(--ink-2)' }}>
            Sales conversations. Marketing decisions. Product research. Engineering trade-offs.
            Operations runbooks. Customer history. The brain organises itself around how your
            business actually runs, and grows every time anyone uses an agent.
          </p>
          <p
            className="mt-10 max-w-[420px] text-[11px] uppercase"
            style={{
              fontFamily: 'var(--font-mono), monospace',
              letterSpacing: '0.14em',
              color: 'var(--ink-3)',
              lineHeight: 1.6,
            }}
          >
            Whatever departments your company has, the brain has a place for them.
          </p>
        </div>

        {/* Right column — letterpress department plate. */}
        <div
          className="paper-scope"
          style={{
            background: 'var(--cream-soft)',
            border: '1px solid var(--paper-rule)',
          }}
        >
          <div
            className="px-7 py-[18px] text-[10px] uppercase"
            style={{
              fontFamily: 'var(--font-mono), monospace',
              letterSpacing: '0.18em',
              color: 'var(--ember)',
              borderBottom: '1px solid var(--paper-rule)',
            }}
          >
            Across&hellip;
          </div>
          {DEPARTMENTS.map((d, i) => (
            <div
              key={d.name}
              className={`flex items-baseline gap-4 px-7 py-[18px] ${
                i < DEPARTMENTS.length - 1 ? 'border-b border-[var(--paper-rule)]' : ''
              }`}
            >
              <span
                className="text-[11px] uppercase"
                style={{
                  fontFamily: 'var(--font-mono), monospace',
                  letterSpacing: '0.14em',
                  color: 'var(--ink-3)',
                }}
              >
                № {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className="text-[22px] leading-[1.2]"
                style={{
                  fontFamily: 'var(--font-display), serif',
                  fontWeight: 400,
                  color: 'var(--ink-1)',
                }}
              >
                <span style={{ fontStyle: 'italic' }}>{d.name}</span>: {d.descriptor}
              </span>
            </div>
          ))}
        </div>
      </div>
    </SectionFrame>
  );
}

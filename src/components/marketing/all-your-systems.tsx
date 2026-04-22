// Section 02 — "All your systems". The breadth-of-connection promise.
// Two-column layout: headline + body + manifesto line on the left, a
// letterpress "Connect to…" plate on the right. Server Component.

import { SectionFrame } from '@/components/marketing/section-frame';

const CONNECTIONS: readonly string[] = [
  'your CRM',
  'your inbox',
  'your lead sources',
  'your marketing channels',
  'your product catalogue',
  'your brand guidelines',
  'your SOPs and playbooks',
  'your support history',
];

export function AllYourSystems() {
  return (
    <SectionFrame id="all-your-systems" number="02" kicker="The Connection">
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-[72px]">
        {/* Left column — headline, lede, manifesto line. */}
        <div>
          <h2 className="t-h2">
            Plug in everything.
            <br />
            <span style={{ fontStyle: 'italic', fontWeight: 300 }}>Forget nothing.</span>
          </h2>
          <p className="t-body mt-6 max-w-[460px] [text-wrap:pretty]" style={{ color: 'var(--ink-2)' }}>
            The knowledge that runs your business is scattered across the tools your team uses
            every day. Tatara connects to every one of them, pulls what matters into a central,
            always-current operating layer, and hands that layer to the agents you&rsquo;ve built.
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
            Works with any agent or automation system. Build with the tools your team already
            uses.
          </p>
        </div>

        {/* Right column — letterpress "Connect to…" plate. */}
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
            Connect to&hellip;
          </div>
          {CONNECTIONS.map((c, i) => (
            <div
              key={c}
              className={`flex items-baseline gap-4 px-7 py-[18px] ${
                i < CONNECTIONS.length - 1 ? 'border-b border-[var(--paper-rule)]' : ''
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
                Connect to <span style={{ fontStyle: 'italic' }}>{c}</span>.
              </span>
            </div>
          ))}
        </div>
      </div>
    </SectionFrame>
  );
}

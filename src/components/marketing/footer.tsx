// Footer — typographic, letterpress-era colophon. Server Component.
// Ported from Tatara/components/Sections.jsx lines 607–677.
//
// Brand note: the original Tatara prototype prefixed "est. MMXXVI" with a
// kanji glyph. The Tatara brand is English-only (per project memo
// feedback_no_japanese_elements), so that character is deliberately removed
// here — only "est. MMXXVI" remains.
//
// Responsive collapse: <900px drops from the 5-col desktop layout to a
// 2-col grid. Chose 2 cols over 1 because the four link lists are short
// enough to pair nicely side-by-side on phone, which keeps the footer
// compact (1-col would force a long vertical scroll at the end of the page).
// The brand column still spans the full width at the top.

import type { CSSProperties } from 'react';
import { Rule, Wordmark } from '@/components/marketing/primitives';

interface LinkList {
  title: string;
  items: readonly string[];
}

const LISTS: readonly LinkList[] = [
  { title: 'Product', items: ['Overview', 'How it works', 'Pricing', 'Changelog', 'Roadmap'] },
  { title: 'Resources', items: ['Docs', 'Brand book', 'Guides', 'Blog', 'API'] },
  { title: 'Company', items: ['About', 'Writing', 'Careers', 'Contact', 'Press'] },
  { title: 'Legal', items: ['Terms', 'Privacy', 'Security', 'DPA', 'Subprocessors'] },
];

const TAGLINE_STYLE: CSSProperties = {
  fontFamily: 'var(--font-display), serif',
  fontStyle: 'italic',
  fontWeight: 300,
  fontSize: 16,
  lineHeight: 1.5,
  color: 'var(--mk-ink-2)',
};

const COLUMN_HEADER_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono), monospace',
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--mk-ink-3)',
};

const LINK_STYLE: CSSProperties = {
  fontFamily: 'var(--font-body), system-ui, sans-serif',
  fontSize: 14,
  color: 'var(--mk-ink)',
  textDecoration: 'none',
  opacity: 0.8,
};

export function Footer() {
  return (
    <footer
      className="px-6 pb-10 pt-[72px] min-[900px]:px-12 min-[900px]:pb-10 min-[900px]:pt-20"
      style={{
        background: 'var(--mk-paper)',
        borderTop: '1px solid var(--mk-rule)',
      }}
    >
      <div className="mx-auto max-w-[1320px]">
        {/* 5-col grid desktop, 2-col grid mobile with brand spanning both. */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 min-[900px]:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] min-[900px]:gap-10">
          {/* Brand column — full-width at mobile (spans 2), 1.4fr at desktop. */}
          <div className="col-span-2 min-[900px]:col-span-1">
            <Wordmark size={26} />
            <p className="mt-4 max-w-[280px]" style={TAGLINE_STYLE}>
              The operator&rsquo;s console for AI labor. Built in small batches, hand-tended,
              kept warm.
            </p>
            <div
              className="mt-6 text-[10px] uppercase tracking-[0.16em]"
              style={{
                fontFamily: 'var(--font-mono), monospace',
                color: 'var(--mk-ink-3)',
              }}
            >
              est. MMXXVI
            </div>
          </div>

          {LISTS.map((list) => (
            <div key={list.title}>
              <div className="mb-4" style={COLUMN_HEADER_STYLE}>
                {list.title}
              </div>
              <ul className="m-0 list-none p-0">
                {list.items.map((item) => (
                  <li key={item} className="mb-2">
                    <a href="#" style={LINK_STYLE}>
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Rule className="mt-16" />

        <div
          className="mt-5 flex flex-col items-start justify-between gap-3 text-[12px] min-[640px]:flex-row min-[640px]:items-center"
          style={{
            fontFamily: 'var(--font-body), system-ui, sans-serif',
            color: 'var(--mk-ink-3)',
          }}
        >
          <div>&copy; 2026 Tatara Works, Ltd. Set in Fraunces &amp; Inter.</div>
          <div className="flex gap-6">
            <a href="#" style={{ color: 'var(--mk-ink-3)' }}>GitHub</a>
            <a href="#" style={{ color: 'var(--mk-ink-3)' }}>X</a>
            <a href="#" style={{ color: 'var(--mk-ink-3)' }}>BlueSky</a>
            <a href="#" style={{ color: 'var(--mk-ink-3)' }}>RSS</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

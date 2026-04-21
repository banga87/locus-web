// Footer — typographic, letterpress-era colophon. Server Component.
//
// Brand note: the original Tatara prototype prefixed the colophon line with a
// kanji glyph. The Tatara brand is English-only (per project memo
// feedback_no_japanese_elements), so no CJK characters appear here. The
// Vol./Iss. metadata line carries the copyright + founding year instead.
//
// Responsive collapse: below `lg:` (1024px) drops from the 5-col desktop
// layout to a 2-col grid. Chose 2 cols over 1 because the four link lists
// are short enough to pair nicely side-by-side on phone, which keeps the
// footer compact (1-col would force a long vertical scroll at the end of
// the page). The brand column still spans the full width at the top.

import { Eyebrow, LetterpressRule, Wordmark } from '@/components/tatara';

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

export function Footer() {
  return (
    <footer
      className="paper-scope px-6 pb-10 pt-[72px] lg:px-12 lg:pb-10 lg:pt-20"
      style={{
        background: 'var(--cream)',
        borderTop: '1px solid var(--paper-rule)',
      }}
    >
      <div className="mx-auto max-w-[1320px]">
        {/* 5-col grid desktop, 2-col grid mobile with brand spanning both. */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] lg:gap-10">
          {/* Brand column — full-width at mobile (spans 2), 1.4fr at desktop. */}
          <div className="col-span-2 lg:col-span-1">
            <Wordmark size={26} />
            <p
              className="mt-4 max-w-[280px]"
              style={{
                fontFamily: 'var(--font-display), serif',
                fontStyle: 'italic',
                fontWeight: 300,
                fontSize: 16,
                lineHeight: 1.5,
                color: 'var(--ink-2)',
              }}
            >
              The operator&rsquo;s console for AI labor. Built in small batches, hand-tended,
              kept warm.
            </p>
          </div>

          {LISTS.map((list) => (
            <div key={list.title}>
              <Eyebrow className="mb-4">{list.title.toUpperCase()}</Eyebrow>
              <ul className="m-0 list-none p-0">
                {list.items.map((item) => (
                  <li key={item} className="mb-2">
                    <a
                      href="#"
                      className="text-[14px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink-1)]"
                      style={{ fontFamily: 'var(--font-body), system-ui, sans-serif' }}
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <LetterpressRule className="mt-16" />

        <div className="mt-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <span
            className="t-mono-label"
            style={{ letterSpacing: '0.18em', opacity: 0.5 }}
          >
            © 2026 · Vol. I · Iss. 01 · est. 2026
          </span>
          <div className="flex gap-6 text-[12px]">
            <a
              href="#"
              className="text-[var(--ink-3)] transition-colors hover:text-[var(--ink-1)]"
            >
              GitHub
            </a>
            <a
              href="#"
              className="text-[var(--ink-3)] transition-colors hover:text-[var(--ink-1)]"
            >
              X
            </a>
            <a
              href="#"
              className="text-[var(--ink-3)] transition-colors hover:text-[var(--ink-1)]"
            >
              BlueSky
            </a>
            <a
              href="#"
              className="text-[var(--ink-3)] transition-colors hover:text-[var(--ink-1)]"
            >
              RSS
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

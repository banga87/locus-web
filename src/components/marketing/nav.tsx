'use client';

// Tatara marketing nav. Client Component because of the mobile dropdown
// toggle + Escape-to-dismiss keydown listener. Sits on top of the hero
// image (absolute variant) by default; pass `absolute={false}` for
// pinned/dark-bar usage in later sections.
//
// Scoping contract: renders inside `.tatara-marketing`, so all `--mk-*`
// tokens and font vars are in scope.
//
// Breakpoint: 1180px (not a Tailwind default). Expressed via
// `min-[1180px]:` arbitrary-breakpoint utilities.

import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import { Wordmark } from '@/components/marketing/primitives';
import { cn } from '@/lib/utils';

const SERIF: CSSProperties = { fontFamily: 'var(--font-display), serif' };

interface NavLink {
  label: string;
  href: string;
}

const NAV_LINKS: readonly NavLink[] = [
  { label: 'Product', href: '#product' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  // Docs + Changelog have no page yet — placeholder anchors.
  { label: 'Docs', href: '#' },
  { label: 'Changelog', href: '#' },
] as const;

export interface NavProps {
  authed?: boolean;
  /** If true (default), nav is absolutely positioned (over the hero image). */
  absolute?: boolean;
  /** If true (default), light text for use over dark imagery. */
  dark?: boolean;
}

export function Nav({ authed = false, absolute = true, dark = true }: NavProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Escape-to-dismiss. Listener is only attached while the menu is open to
  // avoid a background keydown handler in every nav consumer.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Token-driven text color. Light-on-dark = --mk-paper; dark-on-light = --mk-ink.
  // Kept as CSS-var references so palette tweaks flow through.
  const textVar = dark ? 'var(--mk-paper)' : 'var(--mk-ink)';

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav
      className={cn(
        'left-0 right-0 top-0 z-10 flex items-center justify-between gap-4',
        'px-6 py-[18px] min-[1180px]:px-10 min-[1180px]:py-6',
        absolute ? 'absolute' : 'relative',
      )}
      style={{ color: textVar }}
    >
      {/* Left: wordmark + (desktop only) est. 2026 tagline */}
      <div className="flex min-w-0 items-center gap-6">
        <Link href="/" aria-label="Tatara home" className="inline-flex items-center">
          {/* Wordmark auto-reads --mk-ink; override via style when on dark */}
          <Wordmark
            size={22}
            className="min-[1180px]:text-[24px]"
            style={{ color: textVar, fontSize: 'inherit' }}
          />
        </Link>
        <div
          aria-hidden
          className="hidden h-[18px] w-px opacity-25 min-[1180px]:block"
          style={{ background: textVar }}
        />
        <span
          className="hidden whitespace-nowrap text-[13px] italic opacity-70 min-[1180px]:inline"
          style={{ ...SERIF, color: textVar, letterSpacing: '0.01em' }}
        >
          est. 2026
        </span>
      </div>

      {/* Center: desktop nav links */}
      <div
        className="hidden items-center gap-7 text-[14px] font-normal min-[1180px]:flex"
        style={{ fontFamily: 'var(--font-body), system-ui, sans-serif' }}
      >
        {NAV_LINKS.map((item) => (
          <a
            key={item.label}
            href={item.href}
            className="whitespace-nowrap opacity-80 transition-opacity hover:opacity-100"
            style={{ color: textVar }}
          >
            {item.label}
          </a>
        ))}
      </div>

      {/* Right: CTAs + (compact only) hamburger */}
      <div className="flex items-center gap-2">
        {authed ? (
          // Single CTA — "Open app" — styled like the cream-plate Request access.
          <Link
            href="/home"
            className="inline-flex items-center gap-2 whitespace-nowrap border px-4 py-[10px] text-[14px] font-medium transition-colors"
            style={{
              fontFamily: 'var(--font-body), system-ui, sans-serif',
              color: 'var(--mk-ink)',
              background: 'var(--mk-paper)',
              borderColor: 'var(--mk-paper)',
            }}
          >
            Open app
            <span style={{ ...SERIF, fontStyle: 'italic' }}>→</span>
          </Link>
        ) : (
          <>
            {/* Desktop-only Sign in link */}
            <Link
              href="/login"
              className="hidden whitespace-nowrap px-[14px] py-[10px] text-[14px] opacity-80 transition-opacity hover:opacity-100 min-[1180px]:inline-block"
              style={{
                fontFamily: 'var(--font-body), system-ui, sans-serif',
                color: textVar,
              }}
            >
              Sign in
            </Link>
            {/* Request access — anchor hash-scroll to invitation section */}
            <a
              href="#invitation"
              className="inline-flex items-center gap-2 whitespace-nowrap border px-4 py-[10px] text-[14px] font-medium transition-colors"
              style={{
                fontFamily: 'var(--font-body), system-ui, sans-serif',
                color: 'var(--mk-ink)',
                background: 'var(--mk-paper)',
                borderColor: 'var(--mk-paper)',
              }}
            >
              Request access
              <span style={{ ...SERIF, fontStyle: 'italic' }}>→</span>
            </a>
          </>
        )}

        {/* Compact-only hamburger */}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Menu"
          aria-expanded={menuOpen}
          className="inline-flex items-center justify-center border px-3 py-[9px] text-[12px] tracking-[0.12em] min-[1180px]:hidden"
          style={{
            fontFamily: 'var(--font-mono), monospace',
            // Border uses textVar at ~40% alpha. Kept inline rather than tokenized:
            // the alpha blend differs by context (light nav on light = rare).
            borderColor: dark ? 'rgba(245,239,227,0.4)' : 'rgba(27,20,16,0.4)',
            color: textVar,
            background: 'transparent',
          }}
        >
          {menuOpen ? '×' : '≡'}
        </button>
      </div>

      {/* Compact dropdown panel */}
      {menuOpen && (
        <div
          className="absolute left-4 right-4 top-full mt-2 border py-2 shadow-[0_12px_40px_rgba(0,0,0,0.4)] min-[1180px]:hidden"
          style={{
            background: 'var(--mk-ink)',
            color: 'var(--mk-paper)',
            borderColor: 'var(--mk-ink-2)',
          }}
        >
          {NAV_LINKS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={closeMenu}
              className="block border-b px-5 py-3 text-[15px]"
              style={{
                fontFamily: 'var(--font-body), system-ui, sans-serif',
                color: 'var(--mk-paper)',
                // Subtle row separator — --mk-ink darkened; literal justified
                // because there's no --mk-ink-darker token and one row-only
                // separator doesn't warrant adding one.
                borderBottomColor: '#2A211B',
              }}
            >
              {item.label}
            </a>
          ))}
          {!authed && (
            <Link
              href="/login"
              onClick={closeMenu}
              className="block px-5 py-3 text-[15px]"
              style={{
                fontFamily: 'var(--font-body), system-ui, sans-serif',
                color: 'var(--mk-paper)',
              }}
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}

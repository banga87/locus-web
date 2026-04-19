'use client';

// Tatara marketing nav. Client Component because of the mobile dropdown
// toggle + Escape-to-dismiss keydown listener. Sits on top of the hero
// image (absolute variant) by default; pass `absolute={false}` for
// pinned/dark-bar usage in later sections.
//
// Breakpoint: 1180px (not a Tailwind default). Expressed via
// `min-[1180px]:` arbitrary-breakpoint utilities.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon, Wordmark } from '@/components/tatara';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MOBILE_MENU_ID = 'marketing-nav-menu';

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
  // Ref on the hamburger lets us restore focus to it when the menu is
  // dismissed via Escape — otherwise keyboard users get dropped on <body>.
  // We deliberately do NOT restore focus on link-click dismissal: hash links
  // scroll the viewport, and yanking focus back to the hamburger would steal
  // it from where the user expects to land.
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Escape-to-dismiss. Listener is only attached while the menu is open to
  // avoid a background keydown handler in every nav consumer.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Inverted palette is used when the nav floats over the hero plate —
  // HeroPlate provides a dark top-gradient overlay that establishes contrast.
  const inverted = absolute && dark;
  const rootColor = inverted ? 'var(--ink-inverse)' : 'var(--ink-1)';
  const navItemDefault = inverted ? 'var(--ink-inverse-2)' : 'var(--ink-2)';
  const navItemHover = inverted ? 'var(--ink-inverse)' : 'var(--ink-1)';

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav
      className={cn(
        'left-0 right-0 top-0 z-10 flex items-center justify-between gap-4',
        'px-6 py-[18px] min-[1180px]:px-10 min-[1180px]:py-6',
        absolute ? 'absolute' : 'relative',
      )}
      style={{ color: rootColor }}
    >
      {/* Left: wordmark + 1x16 brass rule + (desktop only) est. 2026 lockup.
          Wordmark inherits color from `var(--ink-1)`; wrapping in a span
          that overrides `color` flips it to `--ink-inverse` over the hero. */}
      <div className="flex min-w-0 items-center gap-4">
        <Link href="/" aria-label="Tatara home" className="inline-flex items-center">
          <span style={{ color: rootColor }}>
            <Wordmark size={22} className="min-[1180px]:text-[24px]" />
          </span>
        </Link>
        <div
          aria-hidden
          className="hidden h-4 w-px min-[1180px]:block"
          style={{ background: 'var(--brass)' }}
        />
        <span
          className="hidden whitespace-nowrap text-[13px] italic min-[1180px]:inline"
          style={{
            fontFamily: 'var(--font-display), serif',
            color: navItemDefault,
            letterSpacing: '0.01em',
          }}
        >
          est. 2026
        </span>
      </div>

      {/* Center: desktop nav links.
          Uses Tailwind arbitrary-value utilities for the ember-warm focus
          ring so we inherit the design-system focus affordance. Color
          swap on hover is done via group-less CSS vars rather than
          :hover utilities so the inline `style` source of truth wins. */}
      <div
        className="hidden items-center gap-7 text-[14px] font-normal min-[1180px]:flex"
        style={{ fontFamily: 'var(--font-body), system-ui, sans-serif' }}
      >
        {NAV_LINKS.map((item) => (
          <a
            key={item.label}
            href={item.href}
            className="whitespace-nowrap rounded-[2px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] focus-visible:ring-offset-2 hover:[color:var(--nav-item-hover)]"
            style={
              {
                color: navItemDefault,
                // Custom property consumed by the hover selector above.
                ['--nav-item-hover' as string]: navItemHover,
              } as React.CSSProperties
            }
          >
            {item.label}
          </a>
        ))}
      </div>

      {/* Right: CTAs + (compact only) hamburger */}
      <div className="flex items-center gap-2">
        {authed ? (
          // Single CTA — "Open app" — brass accent button.
          <Button asChild variant="accent">
            <Link href="/home">Open app</Link>
          </Button>
        ) : (
          <>
            {/* Desktop-only Sign in link (ghost button) */}
            <Button asChild variant="ghost" className="hidden min-[1180px]:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            {/* Request access — anchor hash-scroll to invitation section */}
            <Button asChild variant="accent">
              <a href="#invitation">Request access</a>
            </Button>
          </>
        )}

        {/* Compact-only hamburger */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls={MOBILE_MENU_ID}
          className="inline-flex items-center justify-center rounded-[var(--radius-md)] border px-3 py-[9px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] focus-visible:ring-offset-2 min-[1180px]:hidden"
          style={{
            // Border uses the current ink at ~40% alpha — kept inline because
            // the light-on-light case is rare and the blend changes context.
            borderColor: inverted
              ? 'color-mix(in srgb, var(--ink-inverse) 40%, transparent)'
              : 'color-mix(in srgb, var(--ink-1) 40%, transparent)',
            color: rootColor,
            background: 'transparent',
          }}
        >
          <Icon name={menuOpen ? 'X' : 'Menu'} size={16} />
        </button>
      </div>

      {/* Compact dropdown panel */}
      {menuOpen && (
        <div
          id={MOBILE_MENU_ID}
          className="absolute left-4 right-4 top-full mt-2 rounded-[var(--radius-md)] border py-2 shadow-[0_12px_40px_rgba(0,0,0,0.4)] min-[1180px]:hidden"
          style={{
            background: 'var(--surface-0)',
            color: 'var(--ink-1)',
            borderColor: 'var(--paper-rule)',
          }}
        >
          {NAV_LINKS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={closeMenu}
              className="block border-b px-5 py-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] focus-visible:ring-inset"
              style={{
                fontFamily: 'var(--font-body), system-ui, sans-serif',
                color: 'var(--ink-1)',
                borderBottomColor: 'var(--paper-rule)',
              }}
            >
              {item.label}
            </a>
          ))}
          {!authed && (
            <Link
              href="/login"
              onClick={closeMenu}
              className="block px-5 py-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] focus-visible:ring-inset"
              style={{
                fontFamily: 'var(--font-body), system-ui, sans-serif',
                color: 'var(--ink-1)',
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

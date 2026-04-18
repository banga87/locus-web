// Tatara marketing primitives — Server Component-safe.
//
// Scoping contract: these primitives assume they render inside a
// `.tatara-marketing` root (see src/app/(marketing)/layout.tsx +
// marketing.css). They reference `--mk-*` color tokens and
// `--font-display` / `--font-body` / `--font-mono` font vars that are
// only declared inside that scope.
//
// No 'use client' directive. No hooks, no event handlers. Hover states
// use Tailwind's `hover:` prefix so they work in RSC.

import type { CSSProperties, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SERIF: CSSProperties = { fontFamily: 'var(--font-display), serif' };

// --- Wordmark --------------------------------------------------------------

export interface WordmarkProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Wordmark({ size = 28, className, style }: WordmarkProps) {
  return (
    <span
      className={cn('inline-flex items-center text-[color:var(--mk-ink)]', className)}
      style={{
        ...SERIF,
        fontWeight: 500,
        fontSize: size,
        letterSpacing: '-0.01em',
        lineHeight: 1,
        gap: size * 0.35,
        fontOpticalSizing: 'auto',
        fontVariationSettings: '"SOFT" 30, "WONK" 0',
        ...style,
      }}
    >
      <span>Tatara</span>
    </span>
  );
}

// --- SpecLabel — "№ 01 · THE PROMISE" --------------------------------------

export interface SpecLabelProps {
  number?: string | number;
  children: ReactNode;
  className?: string;
}

export function SpecLabel({ number, children, className }: SpecLabelProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-[14px] text-[11px] font-medium uppercase tracking-[0.22em] text-[color:var(--mk-ink-3)]',
        className
      )}
    >
      {number != null && (
        <>
          <span
            className="text-[14px] font-normal normal-case tracking-normal italic"
            style={SERIF}
          >
            № {number}
          </span>
          <span aria-hidden className="h-px w-[18px] bg-[color:var(--mk-ink-3)] opacity-50" />
        </>
      )}
      <span>{children}</span>
    </div>
  );
}

// --- Rule — thin letterpress rule with optional ornament (※) ---------------

export interface RuleProps {
  ornament?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Rule({ ornament = false, className, style }: RuleProps) {
  return (
    <div
      aria-hidden
      className={cn('flex items-center gap-3 text-[color:var(--mk-rule)]', className)}
      style={style}
    >
      <span className="h-px flex-1 bg-current opacity-50" />
      {ornament && (
        <>
          <span className="text-[18px] italic opacity-80" style={SERIF}>※</span>
          <span className="h-px flex-1 bg-current opacity-50" />
        </>
      )}
    </div>
  );
}

// --- BrassButton — primary CTA (flat ink plate, hover → indigo) ------------

export interface BrassButtonProps
  extends Omit<React.ComponentProps<typeof Button>, 'size' | 'variant'> {
  size?: 'md' | 'lg';
  arrow?: boolean;
}

export function BrassButton({
  children,
  className,
  size = 'md',
  arrow = true,
  asChild,
  ...rest
}: BrassButtonProps) {
  const pad = size === 'lg' ? 'px-7 py-[18px] text-[16px]' : 'px-[22px] py-[14px] text-[15px]';
  const arrowSize = size === 'lg' ? 18 : 17;

  return (
    <Button
      asChild={asChild}
      className={cn(
        // Reset shadcn defaults that fight the brass look
        'h-auto rounded-none gap-[10px] font-medium tracking-[0.01em]',
        // Ink plate surface
        'border border-[color:var(--mk-ink)] bg-[color:var(--mk-ink)] text-[color:var(--mk-paper)]',
        // Letterpress hover: swap to indigo
        'transition-colors duration-150 hover:bg-[color:var(--mk-indigo)] hover:border-[color:var(--mk-indigo)]',
        pad,
        className
      )}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {children}
          {arrow && (
            <span
              className="italic leading-none"
              style={{ ...SERIF, fontSize: arrowSize }}
            >
              →
            </span>
          )}
        </>
      )}
    </Button>
  );
}

// --- GhostButton — secondary CTA (transparent, bordered) -------------------

export type GhostButtonProps = Omit<React.ComponentProps<typeof Button>, 'variant'>;

export function GhostButton({ children, className, asChild, ...rest }: GhostButtonProps) {
  return (
    <Button
      asChild={asChild}
      className={cn(
        'h-auto rounded-none px-[22px] py-[14px] text-[15px] font-medium',
        'border border-[color:var(--mk-ink)]/[0.22] bg-transparent text-[color:var(--mk-ink)]',
        'transition-colors duration-150 hover:border-[color:var(--mk-ink)] hover:bg-[color:var(--mk-ink)]/[0.04]',
        className
      )}
      {...rest}
    >
      {children}
    </Button>
  );
}

// --- GaugeNeedle — small animated SVG spinner ------------------------------

export interface GaugeNeedleProps {
  size?: number;
  color?: string;
  className?: string;
}

export function GaugeNeedle({
  size = 18,
  color = 'var(--mk-ember)',
  className,
}: GaugeNeedleProps) {
  return (
    <span
      aria-hidden
      className={cn('relative inline-block align-middle', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <circle cx="20" cy="20" r="18" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1.2" />
        {[-60, -30, 0, 30, 60].map((a) => (
          <line
            key={a}
            x1="20" y1="4" x2="20" y2="7"
            stroke={color} strokeOpacity="0.45" strokeWidth="1"
            transform={`rotate(${a} 20 20)`}
          />
        ))}
        <g
          style={{
            transformOrigin: '20px 20px',
            animation: 'tatara-needle 3.5s ease-in-out infinite',
          }}
        >
          <line x1="20" y1="20" x2="20" y2="6.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="20" cy="20" r="1.8" fill={color} />
        </g>
      </svg>
    </span>
  );
}

// --- Placeholder — pin-striped slab for unfinished imagery -----------------

export interface PlaceholderProps {
  label: string;
  height?: number | string;
  tone?: 'cream' | 'dark';
  className?: string;
}

export function Placeholder({
  label,
  height = 300,
  tone = 'cream',
  className,
}: PlaceholderProps) {
  const isDark = tone === 'dark';
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex w-full items-center justify-center text-[11px] uppercase tracking-[0.12em]',
        isDark
          ? 'border border-[color:var(--mk-rule)]/20 bg-[color:var(--mk-ink)] text-[color:var(--mk-rule)]'
          : 'border border-[color:var(--mk-ink-3)]/20 bg-[color:var(--mk-paper-2)] text-[color:var(--mk-ink-3)]',
        className
      )}
      style={{
        height,
        fontFamily: 'var(--font-mono), monospace',
        backgroundImage:
          'repeating-linear-gradient(135deg, transparent 0 14px, var(--mk-stripe) 14px 15px)',
      }}
    >
      {label}
    </div>
  );
}

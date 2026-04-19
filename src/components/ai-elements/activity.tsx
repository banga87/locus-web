'use client';

// Activity stream typology for the AgentPanel.
//
// Three item kinds:
//   ActivityTool  — transparent mono row showing a tool invocation
//   ActivityThink — italic display paragraph for agent reasoning
//   ActivityDiff  — brass-ruled card with Accept / Amend / Discard controls
//
// These are display-only primitives. Callers supply the data; the
// components handle layout and token application.

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { MonoLabel } from '@/components/tatara';

// ---------------------------------------------------------------------------
// ActivityTool
// ---------------------------------------------------------------------------

export interface ActivityToolProps {
  /** Short identifier rendered in mono uppercase (the "pill name"). */
  toolName: string;
  /** Readable args summary shown in the middle column. */
  subtitle?: string;
  /** Elapsed time string shown right-aligned. */
  elapsed?: string;
  /** Visual state — pending animates the glyph, error is handled by the
   *  caller (ToolCallIndicator keeps its own error path). */
  state?: 'pending' | 'complete' | 'error';
}

/**
 * Transparent mono row for a single tool invocation.
 *
 * Layout: [▸ TOOLNAME] [subtitle ···] [elapsed]
 * No card chrome, no background, no border.
 */
export function ActivityTool({
  toolName,
  subtitle,
  elapsed,
  state = 'complete',
}: ActivityToolProps) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      {/* Left: glyph + tool name */}
      <MonoLabel
        className={[
          'shrink-0 text-[12px] tracking-wider',
          // Override the default ink-3 colour with brass-deep
          'text-[var(--brass-deep)]',
          // Pulse the glyph on pending
          state === 'pending' ? 'animate-pulse' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        ▸ {toolName.toUpperCase()}
      </MonoLabel>

      {/* Middle: subtitle (args summary) — grows to fill */}
      {subtitle && (
        <span
          className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--ink-2)]"
          title={subtitle}
        >
          {subtitle}
        </span>
      )}

      {/* Right: elapsed time */}
      {elapsed && (
        <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--ink-3)]">
          {elapsed}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityThink
// ---------------------------------------------------------------------------

export interface ActivityThinkProps {
  children: ReactNode;
}

/**
 * Italic display paragraph for agent reasoning / thinking text.
 */
export function ActivityThink({ children }: ActivityThinkProps) {
  return (
    <p
      className="font-[var(--font-display)] italic text-[14px] text-[var(--ink-2)]"
    >
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// ActivityDiff
// ---------------------------------------------------------------------------

export interface ActivityDiffProps {
  /** Short title shown in the card body (weight 600, 15px). */
  title: string;
  /** Optional body copy below the title. */
  body?: ReactNode;
  onAccept?: () => void;
  onAmend?: () => void;
  onDiscard?: () => void;
}

/**
 * Brass-ruled diff card with Accept / Amend / Discard controls.
 *
 * Visual spec:
 *   - Brass 12 % wash background
 *   - 2 px left border in var(--brass)
 *   - Mono "DIFF" eyebrow
 *   - Title + optional body copy
 *   - Action row: Accept (accent) · Amend (ghost) · Discard (ghost)
 */
export function ActivityDiff({
  title,
  body,
  onAccept,
  onAmend,
  onDiscard,
}: ActivityDiffProps) {
  return (
    <div
      style={{
        background: 'color-mix(in srgb, var(--brass) 12%, transparent)',
        borderLeft: '2px solid var(--brass)',
        borderRadius: 0,
        padding: '16px 16px 16px 14px',
      }}
    >
      {/* Eyebrow */}
      <MonoLabel
        as="p"
        className="mb-2 text-[11px] tracking-[0.12em] text-[var(--brass-deep)]"
      >
        DIFF
      </MonoLabel>

      {/* Title */}
      <p
        className="mb-1 font-[var(--font-body)] text-[15px] font-semibold text-[var(--ink-1)]"
      >
        {title}
      </p>

      {/* Body copy */}
      {body && (
        <div className="mb-3 font-[var(--font-body)] text-[14px] text-[var(--ink-2)]">
          {body}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="accent" onClick={onAccept} type="button">
          Accept
        </Button>
        <Button size="sm" variant="ghost" onClick={onAmend} type="button">
          Amend
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} type="button">
          Discard
        </Button>
      </div>
    </div>
  );
}

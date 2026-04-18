'use client';

// RunStatusBanner — sticky top banner for the run view.
//
// While running: animated dot + elapsed time ticker + Cancel button.
// On complete:   "Completed in Xs" + optional "View output" link.
// On failed:     "Failed" label + error message excerpt.
// On cancelled:  "Cancelled" label.
//
// The elapsed timer uses setInterval to tick every second. It stops once
// the run reaches a terminal status.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RunStatus } from '@/hooks/use-workflow-run';

interface RunStatusBannerProps {
  status: RunStatus | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  /** Present when run produced output documents (shown after completion). */
  outputDocumentIds: string[];
  onCancel: () => void;
  cancelPending: boolean;
}

function formatElapsed(startedAt: string | null, now: Date): string {
  if (!startedAt) return '—';
  const ms = now.getTime() - new Date(startedAt).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

const TERMINAL: RunStatus[] = ['completed', 'failed', 'cancelled'];

export function RunStatusBanner({
  status,
  startedAt,
  completedAt,
  errorMessage,
  outputDocumentIds,
  onCancel,
  cancelPending,
}: RunStatusBannerProps) {
  const [now, setNow] = useState(() => new Date());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick the elapsed timer every second while running.
  useEffect(() => {
    const isTerminal = status !== null && TERMINAL.includes(status);
    if (isTerminal) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => setNow(new Date()), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const isRunning = status === 'running' || status === 'queued' || status === null;
  const isComplete = status === 'completed';
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm',
        isRunning && 'border-border bg-secondary/60',
        isComplete && 'border-border bg-secondary/60',
        isFailed && 'border-destructive/30 bg-destructive/5',
        isCancelled && 'border-border bg-secondary/60',
      )}
      role="status"
      aria-live="polite"
    >
      {/* Status badge */}
      {isRunning && (
        <span className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          <span className="font-medium text-ink">Running…</span>
        </span>
      )}
      {isComplete && (
        <Badge variant="default">Completed</Badge>
      )}
      {isFailed && (
        <Badge variant="destructive">Failed</Badge>
      )}
      {isCancelled && (
        <Badge variant="outline">Cancelled</Badge>
      )}

      {/* Timing */}
      {isRunning && (
        <span className="text-muted-foreground">
          {formatElapsed(startedAt, now)}
        </span>
      )}
      {isComplete && (
        <span className="text-muted-foreground">
          in {formatDuration(startedAt, completedAt)}
        </span>
      )}

      {/* Error detail */}
      {isFailed && errorMessage && (
        <span className="flex-1 truncate text-destructive/80" title={errorMessage}>
          {errorMessage}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* View output link — shown after completion if output docs present */}
        {isComplete && outputDocumentIds.length > 0 && (
          <Link
            href={`#output`}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            View output ↓
          </Link>
        )}

        {/* Cancel button — only while running */}
        {isRunning && (
          <Button
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={cancelPending}
            title="Cancel — will stop at the next checkpoint"
          >
            {cancelPending ? 'Cancelling…' : 'Cancel'}
          </Button>
        )}
      </div>
    </div>
  );
}

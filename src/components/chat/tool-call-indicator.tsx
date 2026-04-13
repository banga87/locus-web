'use client';

// Inline tool-call indicator rendered inside an assistant message bubble.
//
// States map from the AI SDK v6 `DynamicToolUIPart` `state` field:
//   - 'input-streaming' / 'input-available'           → pending
//   - 'approval-requested' / 'approval-responded'     → pending (we
//     don't surface approval UI in MVP — all tools are read-scoped)
//   - 'output-available'                               → complete (pill)
//   - 'output-error'                                   → error (muted)
//   - 'output-denied'                                  → error (muted)
//
// All Locus tools (brain tools + MCP OUT tools) are built via
// `dynamicTool`, so the part type is always `'dynamic-tool'` with
// `toolName` as a field — see `src/lib/agent/tool-bridge.ts` and
// `src/lib/mcp-out/bridge.ts`.
//
// We intentionally DON'T offer click-to-expand in MVP — the pill is
// just a chip. The plan lists expansion as optional.

import { Loader2Icon, CheckIcon, AlertTriangleIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import { displayToolName, pillToolName } from './tool-display-names';

type IndicatorState = 'pending' | 'complete' | 'error';

interface ToolCallIndicatorProps {
  toolName: string;
  args: unknown;
  state: IndicatorState;
  /** Present when state is 'error'; surfaced as hover title for debugging. */
  errorText?: string;
}

export function ToolCallIndicator({
  toolName,
  args,
  state,
  errorText,
}: ToolCallIndicatorProps) {
  if (state === 'pending') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        <span>{displayToolName(toolName, args)}…</span>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
        title={errorText ?? undefined}
      >
        <AlertTriangleIcon className="size-3" aria-hidden="true" />
        <span>Couldn&apos;t access {pillToolName(toolName, args)}</span>
      </div>
    );
  }

  // complete
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60',
        'px-2 py-0.5 text-xs text-muted-foreground',
      )}
    >
      <CheckIcon className="size-3" aria-hidden="true" />
      <span>
        Used:{' '}
        <span className="font-medium text-foreground">
          {pillToolName(toolName, args)}
        </span>
      </span>
    </div>
  );
}

export type { IndicatorState };

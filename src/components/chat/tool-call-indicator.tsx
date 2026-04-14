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
//
// Special-case: `propose_document_*` tool results carry
// `isProposal: true` on their output and are rendered as a full
// <ProposalCard> with Approve/Discard controls instead of a pill.
// That branch preempts every other state because a completed
// proposal call does not look like a "tool was used" chip — it's a
// live prompt to the user for a decision. See
// `proposal-card.tsx` for the approval flow and
// `propose-document.ts` for the tool definitions.

import { Loader2Icon, CheckIcon, AlertTriangleIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import { ProposalCard, type Proposal } from './proposal-card';
import { displayToolName, pillToolName } from './tool-display-names';

type IndicatorState = 'pending' | 'complete' | 'error';

interface ToolCallIndicatorProps {
  toolName: string;
  args: unknown;
  state: IndicatorState;
  /** Tool output payload. Used to detect propose-tool proposals. */
  result?: unknown;
  /** Present when state is 'error'; surfaced as hover title for debugging. */
  errorText?: string;
}

/**
 * Narrow an unknown tool-result payload to the `{ isProposal, proposal }`
 * shape emitted by `propose_document_*` tools. Returns the `Proposal`
 * object on match, `null` otherwise. Narrow-via-guard rather than a
 * type predicate so the call-site gets `Proposal | null` instead of
 * forcing `result` to be a type-predicate input shape.
 */
function extractProposal(result: unknown): Proposal | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { isProposal?: unknown; proposal?: unknown };
  if (r.isProposal !== true) return null;
  if (!r.proposal || typeof r.proposal !== 'object') return null;
  const p = r.proposal as { kind?: unknown };
  if (p.kind !== 'create' && p.kind !== 'update') return null;
  // At this point the payload shape matches the `Proposal` discriminator.
  // The narrower per-kind fields are validated by the server on approval
  // (the create/update routes re-parse via zod) so we don't re-check here.
  return r.proposal as Proposal;
}

export function ToolCallIndicator({
  toolName,
  args,
  state,
  result,
  errorText,
}: ToolCallIndicatorProps) {
  // Proposal-card branch — preempts every other render when the tool
  // is a propose_document_* AND its output carries `isProposal: true`.
  // The state check is intentionally loose (`complete` OR the payload
  // is present) so a proposal always surfaces even if the AI SDK
  // reports a non-standard state for a side-effect-free tool.
  if (toolName.startsWith('propose_document_')) {
    const proposal = extractProposal(result);
    if (proposal) {
      return <ProposalCard proposal={proposal} />;
    }
  }

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

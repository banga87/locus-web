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

import { PROPOSE_TOOL_PREFIX } from '@/lib/context/proposals';
import { useSkillNames } from '@/lib/skills/use-skill-names';
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
  const p = r.proposal as {
    kind?: unknown;
    title?: unknown;
    target_doc_id?: unknown;
  };
  if (p.kind !== 'create' && p.kind !== 'update') return null;
  // Shallow per-kind field check. The server re-parses the full payload
  // via zod on approval, but a malformed create (valid kind, missing
  // title) would otherwise render a blank card. Return null so the
  // renderer falls back to the default tool-call pill instead of
  // showing empty cells.
  if (p.kind === 'create') {
    if (typeof p.title !== 'string' || p.title.length === 0) return null;
  } else {
    if (typeof p.target_doc_id !== 'string' || p.target_doc_id.length === 0) {
      return null;
    }
  }
  return r.proposal as Proposal;
}

/** Tool names that benefit from skill-name resolution. */
const SKILL_TOOL_NAMES = new Set(['load_skill', 'read_skill_file']);

/**
 * Produce a resolved `displayToolName`-equivalent string for skill tools,
 * substituting the human skill name for the raw id when available.
 */
function resolvedDisplayName(
  toolName: string,
  args: unknown,
  skillNames: Map<string, string>,
): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const skillId = typeof a.skill_id === 'string' ? a.skill_id : '';
  const resolvedName = skillId ? (skillNames.get(skillId) ?? null) : null;

  if (toolName === 'load_skill') {
    return resolvedName
      ? `Loading skill: ${resolvedName}`
      : displayToolName(toolName, args);
  }

  if (toolName === 'read_skill_file') {
    const relativePath =
      typeof a.relative_path === 'string' && a.relative_path.length > 0
        ? a.relative_path
        : 'file';
    return resolvedName
      ? `Reading skill file: ${resolvedName} \u203a ${relativePath}`
      : displayToolName(toolName, args);
  }

  return displayToolName(toolName, args);
}

/**
 * Produce a resolved `pillToolName`-equivalent string for skill tools,
 * substituting the human skill name for the raw id when available.
 */
function resolvedPillName(
  toolName: string,
  args: unknown,
  skillNames: Map<string, string>,
): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const skillId = typeof a.skill_id === 'string' ? a.skill_id : '';
  const resolvedName = skillId ? (skillNames.get(skillId) ?? null) : null;

  if (toolName === 'load_skill') {
    return resolvedName ? `Skill: ${resolvedName}` : pillToolName(toolName, args);
  }

  if (toolName === 'read_skill_file') {
    const relativePath =
      typeof a.relative_path === 'string' && a.relative_path.length > 0
        ? a.relative_path
        : 'file';
    return resolvedName
      ? `Skill file: ${resolvedName} \u203a ${relativePath}`
      : pillToolName(toolName, args);
  }

  return pillToolName(toolName, args);
}

export function ToolCallIndicator({
  toolName,
  args,
  state,
  result,
  errorText,
}: ToolCallIndicatorProps) {
  // Skill-name resolution — only fetches /api/skills for the two skill tools
  // (SWR de-dupes the request if the skills index page is also mounted).
  const skillNames = useSkillNames();
  const isSkillTool = SKILL_TOOL_NAMES.has(toolName);

  // Proposal-card branch — preempts every other render when the tool
  // is a propose_document_* AND its output carries `isProposal: true`.
  // The state check is intentionally loose (`complete` OR the payload
  // is present) so a proposal always surfaces even if the AI SDK
  // reports a non-standard state for a side-effect-free tool.
  if (toolName.startsWith(PROPOSE_TOOL_PREFIX)) {
    const proposal = extractProposal(result);
    if (proposal) {
      return <ProposalCard proposal={proposal} />;
    }
  }

  if (state === 'pending') {
    const label = isSkillTool
      ? resolvedDisplayName(toolName, args, skillNames)
      : displayToolName(toolName, args);
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        <span>{label}…</span>
      </div>
    );
  }

  if (state === 'error') {
    const label = isSkillTool
      ? resolvedPillName(toolName, args, skillNames)
      : pillToolName(toolName, args);
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
        title={errorText ?? undefined}
      >
        <AlertTriangleIcon className="size-3" aria-hidden="true" />
        <span>Couldn&apos;t access {label}</span>
      </div>
    );
  }

  // complete
  const label = isSkillTool
    ? resolvedPillName(toolName, args, skillNames)
    : pillToolName(toolName, args);
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
          {label}
        </span>
      </span>
    </div>
  );
}

export type { IndicatorState };

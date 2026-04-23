'use client';

// RunView — reattachable live run view for triggered skills.
//
// Relocated from src/components/workflows/run-view.tsx during the
// skill/workflow unification. The `workflowSlug` prop is replaced by
// `skillId` (id-based detail path); everything else is unchanged.
//
// Architecture:
//   - useWorkflowRun hook provides events + status metadata + cancel().
//     (Hook keeps its name — it operates on the workflow_runs table which
//     is unchanged; the user-facing concept is "triggered skill".)
//   - A reducer collapses the flat event stream into UI-level "turns":
//       Each turn has an ordered list of items — text, tool-call, reasoning —
//       in the order they were emitted. Consecutive llm_delta / reasoning
//       events coalesce into the same text/reasoning item so a tool call
//       that arrives between deltas splits the block at that point.
//   - Event → UI mapping:
//       turn_start     → start a new turn (no card)
//       llm_delta      → append to the trailing text item (or create one)
//       turn_complete  → finalise the turn
//       tool_start     → push a tool-call item (state: pending)
//       tool_result    → update matching tool-call item (by toolCallId)
//       reasoning      → append to the trailing reasoning item (or create one)
//       run_error      → inline error notice
//       run_complete   → no card; triggers OutputCard to appear via status
//
// Payload field names are camelCase (toolName, toolCallId, isError, delta)
// — matching the AgentEvent shape the runner strips `type` off and persists
// verbatim (see `src/lib/skills/run-triggered.ts` and
// `src/lib/agent/types.ts`).
//
// AI Elements reuse:
//   - MessageResponse (Streamdown) for accumulated LLM text — same component
//     used in MessageBubble. Read-only: no input, no proposal cards.
//   - ToolCallIndicator for tool_start / tool_result events — same chip
//     component used by MessageBubble. Proposal detection disabled (we pass
//     no result payload for tool_start events; tool_result payloads flow
//     through naturally but propose_document tools won't render a live
//     approval card in read-only context).
//
// The component is client-only; the page server component handles auth/ACL
// and passes the runId down.

import { useMemo } from 'react';
import { AlertTriangleIcon } from 'lucide-react';

import { MessageResponse } from '@/components/ai-elements/message';
import { ToolCallIndicator } from '@/components/chat/tool-call-indicator';
import { cn } from '@/lib/utils';
import {
  useWorkflowRun,
  type WorkflowRunEvent,
} from '@/hooks/use-workflow-run';

import { OutputCard } from './output-card';
import { RunStatusBanner } from './run-status-banner';

// ---------------------------------------------------------------------------
// Types for the UI model
// ---------------------------------------------------------------------------

interface ToolCallEntry {
  toolCallId: string; // LLM-side tool-call id (e.g. toolu_xxx)
  toolName: string;
  args: unknown;
  state: 'pending' | 'complete' | 'error';
  result?: unknown;
  errorText?: string;
}

type TurnItem =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; entry: ToolCallEntry };

interface Turn {
  id: string; // = turn_start event id
  items: TurnItem[];
  complete: boolean;
}

interface UIModel {
  turns: Turn[];
  runError: string | null;
}

// ---------------------------------------------------------------------------
// Event-stream reducer
// ---------------------------------------------------------------------------

/**
 * Reduce the flat event log into turns with ordered items. Exported for
 * unit testing — the component itself wraps it in `useMemo`.
 *
 * Field-name discipline: payloads are the AgentEvent shape with `type`
 * stripped (see `src/lib/skills/run-triggered.ts`), so field names are
 * camelCase (`toolName`, `toolCallId`, `isError`, `delta`). Reading
 * snake_case keys here would silently return undefined and render
 * "Unknown" tool pills.
 */
export function buildUIModel(events: WorkflowRunEvent[]): UIModel {
  const turns: Turn[] = [];
  let runError: string | null = null;

  // Match tool_result back to its tool_start by the LLM's toolCallId.
  // The DB event UUID (ev.id) is not used for correlation — tool_result
  // payloads don't carry it, only the toolCallId the LLM assigned.
  const toolCallById = new Map<string, ToolCallEntry>();

  for (const ev of events) {
    switch (ev.eventType) {
      case 'turn_start': {
        turns.push({ id: ev.id, items: [], complete: false });
        break;
      }

      case 'llm_delta': {
        const current = turns[turns.length - 1];
        if (!current) break;
        const delta = (ev.payload['delta'] as string) ?? '';
        if (delta.length === 0) break;
        const last = current.items[current.items.length - 1];
        if (last && last.kind === 'text') {
          last.text += delta;
        } else {
          current.items.push({ kind: 'text', id: ev.id, text: delta });
        }
        break;
      }

      case 'reasoning': {
        const current = turns[turns.length - 1];
        if (!current) break;
        const delta = (ev.payload['delta'] as string) ?? '';
        if (delta.length === 0) break;
        const last = current.items[current.items.length - 1];
        if (last && last.kind === 'reasoning') {
          last.text += delta;
        } else {
          current.items.push({ kind: 'reasoning', id: ev.id, text: delta });
        }
        break;
      }

      case 'tool_start': {
        const current = turns[turns.length - 1];
        if (!current) break;
        const toolCallId = (ev.payload['toolCallId'] as string) ?? ev.id;
        const entry: ToolCallEntry = {
          toolCallId,
          toolName: (ev.payload['toolName'] as string) ?? 'unknown',
          args: ev.payload['args'],
          state: 'pending',
        };
        current.items.push({ kind: 'tool', id: ev.id, entry });
        toolCallById.set(toolCallId, entry);
        break;
      }

      case 'tool_result': {
        const toolCallId = (ev.payload['toolCallId'] as string) ?? '';
        const entry = toolCallById.get(toolCallId);
        if (!entry) break;
        const isError = ev.payload['isError'] === true;
        entry.state = isError ? 'error' : 'complete';
        entry.result = ev.payload['result'];
        if (isError) {
          entry.errorText = extractErrorText(ev.payload['result']);
        }
        break;
      }

      case 'turn_complete': {
        const current = turns[turns.length - 1];
        if (current) current.complete = true;
        break;
      }

      case 'run_error': {
        runError = (ev.payload['message'] as string) ?? 'An error occurred.';
        break;
      }

      case 'run_complete':
        // No UI action — the status banner reacts to meta.status changing.
        break;
    }
  }

  return { turns, runError };
}

/**
 * Pull a display string out of a tool_result error payload. Tool errors
 * come through as whatever the AI SDK attached to `part.error`, which is
 * typically an Error-like `{ message }` but can be any value. Fall back
 * to a JSON rendering so something shows up in the indicator's hover
 * title instead of `undefined`.
 */
function extractErrorText(result: unknown): string | undefined {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const msg = (result as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
    try {
      return JSON.stringify(result);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReasoningBlock({ text }: { text: string }) {
  return (
    <p className="border-l-2 border-muted pl-3 text-xs italic text-muted-foreground">
      {text}
    </p>
  );
}

function TurnCard({ turn }: { turn: Turn }) {
  // Filter out pure-whitespace text items so a trailing `\n\n` between a
  // tool call and the next event doesn't render as an empty paragraph.
  const visibleItems = turn.items.filter((item) => {
    if (item.kind === 'tool') return true;
    return item.text.trim().length > 0;
  });

  if (visibleItems.length === 0) return null;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-card-foreground">
      {visibleItems.map((item) => {
        if (item.kind === 'reasoning') {
          return <ReasoningBlock key={item.id} text={item.text} />;
        }
        if (item.kind === 'tool') {
          return (
            <div key={item.id} className="py-0.5">
              <ToolCallIndicator
                toolName={item.entry.toolName}
                args={item.entry.args}
                state={item.entry.state}
                result={item.entry.result}
                errorText={item.entry.errorText}
              />
            </div>
          );
        }
        // Text — Streamdown for safe incremental markdown rendering,
        // matching the chat UI.
        return (
          <div key={item.id} className="chat-markdown">
            <MessageResponse>{item.text}</MessageResponse>
          </div>
        );
      })}
    </div>
  );
}

function RunErrorNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
      </div>
    );
  }
  return (
    <p className="py-12 text-sm text-muted-foreground">
      No events yet. The run may still be starting.
    </p>
  );
}

// ---------------------------------------------------------------------------
// RunView
// ---------------------------------------------------------------------------

interface RunViewProps {
  runId: string;
  /**
   * The owning skill's document id. Reserved for future back-link
   * navigation + breadcrumb affordances; the page component already
   * renders the breadcrumb itself so the component does not currently
   * use it, but keeping it in the props keeps the id-based routing
   * contract symmetric with the old slug-based RunView.
   */
  skillId: string;
}

// Intentional underscore: see RunViewProps docstring — the prop is reserved
// for future use; keeping it named keeps call-sites stable.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function RunView({ runId, skillId: _skillId }: RunViewProps) {
  const { events, meta, loading, cancel, cancelPending } =
    useWorkflowRun(runId);

  const uiModel = useMemo(() => buildUIModel(events), [events]);

  const outputDocumentIds: string[] = meta?.outputDocumentIds ?? [];
  const isComplete = meta?.status === 'completed';

  return (
    <div className="flex flex-col gap-4">
      {/* Status banner — always visible */}
      <RunStatusBanner
        status={meta?.status ?? null}
        startedAt={meta?.startedAt ?? null}
        completedAt={meta?.completedAt ?? null}
        errorMessage={meta?.errorMessage ?? null}
        outputDocumentIds={outputDocumentIds}
        onCancel={cancel}
        cancelPending={cancelPending}
      />

      {/* Event stream */}
      <div className={cn('flex flex-col gap-3', loading && events.length === 0 && 'items-center')}>
        {events.length === 0 ? (
          <EmptyState loading={loading} />
        ) : (
          <>
            {uiModel.turns.map((turn) => (
              <TurnCard key={turn.id} turn={turn} />
            ))}
            {uiModel.runError && (
              <RunErrorNotice message={uiModel.runError} />
            )}
          </>
        )}
      </div>

      {/* Output card — client-side, driven by the live hook state so it
          appears the moment `run_complete` lands (no page refresh needed).
          OutputCard itself batches a POST to /api/brain/documents/titles
          to render titles + links. When documentIds is empty, the card
          renders nothing, so this condition + the card's own guard are
          belt-and-suspenders. The card's id="output" is the scroll target
          for the banner's "View output ↓" link. */}
      {isComplete && outputDocumentIds.length > 0 && (
        <OutputCard documentIds={outputDocumentIds} />
      )}
    </div>
  );
}

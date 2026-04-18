'use client';

// RunView — reattachable live run view (Task 8).
//
// Architecture:
//   - useWorkflowRun hook provides events + status metadata + cancel().
//   - A reducer collapses the flat event stream into UI-level "turns":
//       Each turn has an accumulated text message and a list of tool calls.
//   - Event → UI mapping:
//       turn_start     → start a new turn (no card)
//       llm_delta      → accumulate text into the current turn's message
//       turn_complete  → finalise current turn's message (no card of its own)
//       tool_start     → push a tool-call entry (state: pending)
//       tool_result    → update matching tool-call entry (state: complete/error)
//       reasoning      → attach as a reasoning block on the current turn
//       run_error      → inline error notice
//       run_complete   → no card; triggers OutputCard to appear via status
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
  toolCallId: string; // = event id for tool_start
  toolName: string;
  args: unknown;
  state: 'pending' | 'complete' | 'error';
  result?: unknown;
  errorText?: string;
}

interface ReasoningEntry {
  text: string;
}

interface Turn {
  id: string; // = turn_start event id
  text: string; // accumulated from llm_delta
  toolCalls: ToolCallEntry[];
  reasoning: ReasoningEntry[];
  complete: boolean;
}

interface UIModel {
  turns: Turn[];
  runError: string | null;
}

// ---------------------------------------------------------------------------
// Event-stream reducer
// ---------------------------------------------------------------------------

function buildUIModel(events: WorkflowRunEvent[]): UIModel {
  const turns: Turn[] = [];
  let runError: string | null = null;

  // Index tool_start events by their id so tool_result can update them.
  // tool_start.id is the event UUID; tool_result payload carries tool_start_id.
  const toolCallByEventId = new Map<string, ToolCallEntry>();

  for (const ev of events) {
    switch (ev.eventType) {
      case 'turn_start': {
        turns.push({
          id: ev.id,
          text: '',
          toolCalls: [],
          reasoning: [],
          complete: false,
        });
        break;
      }

      case 'llm_delta': {
        const current = turns[turns.length - 1];
        if (!current) break;
        const delta = (ev.payload['delta'] as string) ?? '';
        current.text += delta;
        break;
      }

      case 'turn_complete': {
        const current = turns[turns.length - 1];
        if (current) current.complete = true;
        break;
      }

      case 'tool_start': {
        const current = turns[turns.length - 1];
        if (!current) break;
        const entry: ToolCallEntry = {
          toolCallId: ev.id,
          toolName: (ev.payload['tool_name'] as string) ?? 'unknown',
          args: ev.payload['args'],
          state: 'pending',
        };
        current.toolCalls.push(entry);
        toolCallByEventId.set(ev.id, entry);
        break;
      }

      case 'tool_result': {
        const startId = (ev.payload['tool_start_id'] as string) ?? '';
        const entry = toolCallByEventId.get(startId);
        if (!entry) break;
        const isError = ev.payload['error'] === true;
        entry.state = isError ? 'error' : 'complete';
        entry.result = ev.payload['result'];
        if (isError) {
          const msg = ev.payload['message'];
          entry.errorText = typeof msg === 'string' ? msg : undefined;
        }
        break;
      }

      case 'reasoning': {
        const current = turns[turns.length - 1];
        if (!current) break;
        const text = (ev.payload['text'] as string) ?? '';
        current.reasoning.push({ text });
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
  const hasContent =
    turn.text.trim().length > 0 ||
    turn.toolCalls.length > 0 ||
    turn.reasoning.length > 0;

  if (!hasContent) return null;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-card-foreground">
      {/* Reasoning blocks — rendered above the message text, subtle. */}
      {turn.reasoning.map((r, i) => (
        <ReasoningBlock key={i} text={r.text} />
      ))}

      {/* Tool calls */}
      {turn.toolCalls.map((tc) => (
        <div key={tc.toolCallId} className="py-0.5">
          <ToolCallIndicator
            toolName={tc.toolName}
            args={tc.args}
            state={tc.state}
            result={tc.result}
            errorText={tc.errorText}
          />
        </div>
      ))}

      {/* Accumulated LLM text — uses Streamdown (MessageResponse) for
          safe incremental markdown rendering, matching the chat UI. */}
      {turn.text.trim().length > 0 && (
        <div className="chat-markdown">
          <MessageResponse>{turn.text}</MessageResponse>
        </div>
      )}
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
  workflowSlug: string;
}

export function RunView({ runId, workflowSlug }: RunViewProps) {
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

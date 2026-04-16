'use client';

// useWorkflowRun — reattach-safe hook for the run view.
//
// Design contract (Task 8):
//   1. On mount: GET /api/workflows/runs/:id/events → initial event list.
//   2. On mount: GET /api/workflows/runs/:id → status metadata.
//   3. Subscribe Supabase Realtime INSERT on workflow_run_events for this run.
//   4. On INSERT: append if sequence > last-seen (dedup idempotent).
//   5. On run_complete / run_error: re-fetch status metadata.
//   6. Periodic backfill: poll ?after=lastSeq every 10 s while running, to
//      recover any events Realtime dropped (the DB is the source of truth).
//   7. cancel(): POST /api/workflows/runs/:id/cancel.
//
// Reattach safety: closing and reopening the tab re-runs the initial GET
// from sequence 0, loading ALL events from the DB. Any events that arrived
// while the tab was closed are included. Realtime then picks up from there.
//
// The hook does NOT use SWR or React Query — keeping it self-contained
// avoids adding a dependency that isn't already in the project.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types — mirroring the DB schema / API response shapes
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkflowEventType =
  | 'turn_start'
  | 'llm_delta'
  | 'tool_start'
  | 'tool_result'
  | 'reasoning'
  | 'turn_complete'
  | 'run_error'
  | 'run_complete';

export interface WorkflowRunEvent {
  id: string;
  runId: string;
  sequence: number;
  eventType: WorkflowEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RunMeta {
  id: string;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  outputDocumentIds: string[];
  errorMessage: string | null;
}

export interface UseWorkflowRunResult {
  events: WorkflowRunEvent[];
  meta: RunMeta | null;
  /** True while the initial HTTP fetches are in flight. */
  loading: boolean;
  cancel: () => Promise<void>;
  cancelPending: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKFILL_INTERVAL_MS = 10_000; // 10 s

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkflowRun(runId: string): UseWorkflowRunResult {
  const [events, setEvents] = useState<WorkflowRunEvent[]>([]);
  const [meta, setMeta] = useState<RunMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelPending, setCancelPending] = useState(false);

  // lastSeq tracks the highest sequence number we have locally.
  // Using a ref (not state) so the Realtime callback closure always reads
  // the current value without stale-closure issues.
  const lastSeqRef = useRef<number>(-1);
  const cancelledRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Fetch helpers
  // ---------------------------------------------------------------------------

  const fetchMeta = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}`);
      if (!res.ok) return;
      const data = (await res.json()) as RunMeta;
      if (cancelledRef.current) return;
      setMeta(data);
    } catch {
      // Network error — non-fatal; status will be stale but events continue.
    }
  }, [runId]);

  const fetchEvents = useCallback(async (after?: number) => {
    try {
      const url =
        after !== undefined && after >= 0
          ? `/api/workflows/runs/${runId}/events?after=${after}`
          : `/api/workflows/runs/${runId}/events`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as { events: WorkflowRunEvent[] };
      if (cancelledRef.current) return;

      if (data.events.length === 0) return;

      setEvents((prev) => {
        // Merge: keep existing events, append any with sequence > lastSeq.
        // This handles both initial load (after = undefined) and backfill.
        if (after === undefined) {
          // Initial load — replace entirely.
          const sorted = [...data.events].sort((a, b) => a.sequence - b.sequence);
          const maxSeq = sorted[sorted.length - 1]?.sequence ?? -1;
          lastSeqRef.current = maxSeq;
          return sorted;
        }
        // Incremental — append only genuinely new events.
        const newEvents = data.events.filter(
          (e) => e.sequence > lastSeqRef.current,
        );
        if (newEvents.length === 0) return prev;
        const maxSeq = Math.max(...newEvents.map((e) => e.sequence));
        lastSeqRef.current = maxSeq;
        return [...prev, ...newEvents];
      });
    } catch {
      // Network error — non-fatal.
    }
  }, [runId]);

  // ---------------------------------------------------------------------------
  // Main effect: initial load + Realtime subscription + backfill timer
  // ---------------------------------------------------------------------------

  useEffect(() => {
    cancelledRef.current = false;
    lastSeqRef.current = -1;

    let backfillTimer: ReturnType<typeof setInterval> | null = null;

    // 1. Initial data fetch (events + meta in parallel)
    Promise.all([fetchEvents(undefined), fetchMeta()]).finally(() => {
      if (!cancelledRef.current) setLoading(false);
    });

    // 2. Supabase Realtime subscription
    const supabase = createClient();
    const channel = supabase
      .channel(`workflow_run:${runId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'workflow_run_events',
          filter: `run_id=eq.${runId}`,
        },
        (payload) => {
          if (cancelledRef.current) return;
          const ev = payload.new as WorkflowRunEvent;
          if (ev.sequence <= lastSeqRef.current) return; // already have it

          lastSeqRef.current = ev.sequence;
          setEvents((prev) => [...prev, ev]);

          // Refresh run metadata when a terminal event arrives
          if (ev.eventType === 'run_complete' || ev.eventType === 'run_error') {
            void fetchMeta();
          }
        },
      )
      .subscribe();

    // 3. Periodic backfill — recovers Realtime gaps while the run is active.
    //    Stops once the run reaches a terminal status.
    backfillTimer = setInterval(() => {
      if (cancelledRef.current) return;
      // Only backfill while we don't have a terminal status locally.
      // meta might not be set yet on first tick, so treat null as running.
      const terminalStatuses: RunStatus[] = ['completed', 'failed', 'cancelled'];
      const isTerminal = meta !== null && terminalStatuses.includes(meta.status);
      if (isTerminal) {
        if (backfillTimer) clearInterval(backfillTimer);
        return;
      }
      void fetchEvents(lastSeqRef.current);
    }, BACKFILL_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      if (backfillTimer) clearInterval(backfillTimer);
      void supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // ---------------------------------------------------------------------------
  // Cancel action
  // ---------------------------------------------------------------------------

  const cancel = useCallback(async () => {
    if (cancelPending) return;
    setCancelPending(true);
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/cancel`, {
        method: 'POST',
      });
      if (res.status === 409) {
        // Already terminal — refresh meta to show the actual current status.
        await fetchMeta();
      }
      // On 200: status update flows through next event or next meta refresh.
    } catch {
      // Network error — user can retry.
    } finally {
      setCancelPending(false);
    }
  }, [runId, cancelPending, fetchMeta]);

  return { events, meta, loading, cancel, cancelPending };
}

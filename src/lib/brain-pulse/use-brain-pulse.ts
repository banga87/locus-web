'use client';

// Single source of truth for Neurons client state.
//
// T9: seed graph, ONE Realtime channel per brain, filter excluded categories,
//     batch through eventBatcher, orphanQueue for target-unknown events,
//     activeAgents + eventRate60s derived. Cleanup on unmount.
// T10: SWR wraps GET /api/brain/[slug]/graph with fallbackData=seed. On
//     document_mutation create: revalidate + hold in orphan queue until node
//     appears. On delete: revalidate + fall through to batcher. On channel
//     error: reconnecting; after 60s: paused. companyId in dep array for
//     cross-company switch re-subscription. Orphan queue drained on new nodes.

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import type { GraphResponse } from '@/lib/graph/derive-graph';
import { resolveAgentColor } from './agent-palette';
import { createEventBatcher } from './event-batcher';
import { filterEvent } from './event-filter';
import { createOrphanQueue } from './orphan-queue';
import type {
  ActiveAgent, ActorType, BrainPulseEventBase, BrainPulseState, ConnectionStatus,
} from './types';

export interface UseBrainPulseInput {
  brainId: string;
  companyId: string;
  seedGraph: GraphResponse;
  supabaseClient?: SupabaseClient;
}

interface AuditEventRow {
  id: string; created_at: string;
  company_id: string; brain_id: string | null;
  actor_type: ActorType; actor_id: string; actor_name: string | null;
  target_type: string | null; target_id: string | null;
  category: string; event_type: string;
  details: Record<string, unknown> | null;
}

const WINDOW_MS = 60_000;
const MAX_EVENTS_RETAINED = 500;

function rowToEvent(row: AuditEventRow): BrainPulseEventBase | null {
  const candidate = {
    id: row.id,
    createdAt: new Date(row.created_at),
    companyId: row.company_id,
    brainId: row.brain_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorName: row.actor_name ?? 'Unknown',
    targetType: row.target_type,
    targetId: row.target_id,
    category: row.category,
    eventType: row.event_type,
    details: row.details ?? {},
  };
  const accepted = filterEvent(candidate);
  if (!accepted) return null;
  return accepted as BrainPulseEventBase;
}

export function useBrainPulse(input: UseBrainPulseInput): BrainPulseState {
  const supabase = useMemo(
    () => input.supabaseClient ?? createClient(),
    [input.supabaseClient],
  );

  // SWR-backed graph: falls back to seed on first render, revalidates on focus
  // and when document_mutation events trigger an explicit mutate() call.
  const { data: graphData, error: graphError, mutate: revalidateGraph } = useSWR<GraphResponse>(
    `/api/brain/${input.seedGraph.brain.slug}/graph`,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error('graph_fetch_failed');
      return r.json() as Promise<GraphResponse>;
    },
    { fallbackData: input.seedGraph, revalidateOnFocus: true, dedupingInterval: 30_000 },
  );
  const graph = graphData ?? input.seedGraph;

  const [events, setEvents] = useState<BrainPulseEventBase[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');

  const channelRef = useRef<RealtimeChannel | null>(null);
  const batcherRef = useRef<ReturnType<typeof createEventBatcher<BrainPulseEventBase>> | null>(null);
  const orphanRef = useRef<ReturnType<typeof createOrphanQueue<BrainPulseEventBase>> | null>(null);
  const knownNodeIdsRef = useRef<Set<string>>(new Set(input.seedGraph.nodes.map((n) => n.id)));
  const prevNodeIdsRef = useRef<Set<string>>(new Set(input.seedGraph.nodes.map((n) => n.id)));
  const pausedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drain the orphan queue whenever SWR delivers new nodes.
  useEffect(() => {
    const prev = prevNodeIdsRef.current;
    const next = new Set(graph.nodes.map((n) => n.id));
    for (const id of next) if (!prev.has(id)) orphanRef.current?.resolveKey(id);
    prevNodeIdsRef.current = next;
    knownNodeIdsRef.current = next;
  }, [graph]);

  // Keep a stable ref to revalidateGraph so the channel closure doesn't go stale.
  const revalidateGraphRef = useRef(revalidateGraph);
  useEffect(() => { revalidateGraphRef.current = revalidateGraph; }, [revalidateGraph]);

  useEffect(() => {
    function ingest(evt: BrainPulseEventBase) {
      // document_mutation: trigger SWR revalidation immediately.
      // On create: also hold in orphan queue until the new node appears in graph.
      // On delete: fall through to batcher (T17 handles destructive-color pulse).
      if (evt.category === 'document_mutation') {
        void revalidateGraphRef.current();
        const isCreate =
          evt.eventType === 'document.create' ||
          evt.eventType === 'document.created';
        if (isCreate && evt.targetId && !knownNodeIdsRef.current.has(evt.targetId)) {
          orphanRef.current?.enqueue({ key: evt.targetId, payload: evt });
          return;
        }
        batcherRef.current?.push(evt);
        return;
      }
      // Non-mutation events targeting an unknown document: hold in orphan queue.
      if (
        evt.targetType === 'document' &&
        evt.targetId &&
        !knownNodeIdsRef.current.has(evt.targetId)
      ) {
        orphanRef.current?.enqueue({ key: evt.targetId, payload: evt });
        return;
      }
      batcherRef.current?.push(evt);
    }

    orphanRef.current = createOrphanQueue<BrainPulseEventBase>({
      timeoutMs: 2000,
      onRelease: (entry) => ingest(entry.payload),
      onDrop: () => {},
    });
    batcherRef.current = createEventBatcher<BrainPulseEventBase>({
      initialIntervalMs: 100,
      highLoadIntervalMs: 250,
      highLoadThreshold: 10,
      flush: (batch) => {
        setEvents((prev) => [...batch, ...prev].slice(0, MAX_EVENTS_RETAINED));
      },
    });

    const channel = supabase
      .channel(`brain-pulse:${input.brainId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'audit_events', filter: `brain_id=eq.${input.brainId}` },
        (payload: { new: unknown }) => {
          const row = payload.new as AuditEventRow;
          const evt = rowToEvent(row);
          if (!evt) return;
          ingest(evt);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          if (pausedTimerRef.current) {
            clearTimeout(pausedTimerRef.current);
            pausedTimerRef.current = null;
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          setConnectionStatus('reconnecting');
          if (!pausedTimerRef.current) {
            pausedTimerRef.current = setTimeout(() => setConnectionStatus('paused'), 60_000);
          }
        }
      });

    channelRef.current = channel;

    return () => {
      batcherRef.current?.dispose();
      orphanRef.current?.dispose();
      if (pausedTimerRef.current) {
        clearTimeout(pausedTimerRef.current);
        pausedTimerRef.current = null;
      }
      const c = channelRef.current;
      channelRef.current = null;
      if (c) {
        void c.unsubscribe();
        void supabase.removeChannel(c);
      }
    };
  }, [supabase, input.brainId, input.companyId]);

  const now = Date.now();
  const activeAgents: ActiveAgent[] = useMemo(() => {
    const byId = new Map<string, ActiveAgent>();
    for (const e of events) {
      if (now - e.createdAt.getTime() > WINDOW_MS) continue;
      const cur = byId.get(e.actorId);
      if (cur) {
        cur.countLast60s += 1;
        cur.lastSeenAt = Math.max(cur.lastSeenAt, e.createdAt.getTime());
      } else {
        byId.set(e.actorId, {
          id: e.actorId, type: e.actorType, name: e.actorName,
          color: resolveAgentColor(e.actorId),
          countLast60s: 1, lastSeenAt: e.createdAt.getTime(),
        });
      }
    }
    return [...byId.values()].sort((a, b) => b.countLast60s - a.countLast60s);
  }, [events, now]);

  const eventRate60s = useMemo(
    () => events.filter((e) => now - e.createdAt.getTime() <= WINDOW_MS).length,
    [events, now],
  );

  return {
    graph,
    events,
    pulses: [],
    mcpCallLines: [],
    activeAgents,
    mcpConnections: graph.mcpConnections,
    eventRate60s,
    connectionStatus,
    graphError: graphError ?? null,
    retryGraph: () => { void revalidateGraph(); },
  };
}

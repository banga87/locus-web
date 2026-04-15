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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import type { GraphResponse } from '@/lib/graph/derive-graph';
import { resolveAgentColor } from './agent-palette';
import { createEventBatcher } from './event-batcher';
import { filterEvent } from './event-filter';
import { createOrphanQueue } from './orphan-queue';
import type {
  ActiveAgent, ActorType, BrainPulseEventBase, BrainPulseState, ConnectionStatus, McpCallLine, Pulse,
} from './types';

const PULSE_DURATION_MS = 1200;
const CREATE_PULSE_DURATION_MS = 2000;
const DELETE_PULSE_DURATION_MS = 800;
const MAX_CONCURRENT_PULSES = 40;

const MCP_INVOKE_TTL_MS = 15_000;
const MCP_RETURN_FADE_MS = 600;
const PENDING_COMPLETE_BUFFER_MS = 2_000;

function pulseDurationFor(evt: BrainPulseEventBase): number {
  if (evt.category === 'document_mutation' && evt.eventType === 'delete') return DELETE_PULSE_DURATION_MS;
  if (evt.category === 'document_mutation' && (evt.eventType === 'create' || evt.eventType === 'document.create' || evt.eventType === 'document.created')) return CREATE_PULSE_DURATION_MS;
  return PULSE_DURATION_MS;
}

// These refs are passed in so helpers remain pure functions without closures
// that would capture stale ref values.
function processMcpEvent(
  evt: BrainPulseEventBase,
  inFlightRef: React.MutableRefObject<Map<string, McpCallLine>>,
  pendingCompletesRef: React.MutableRefObject<Map<string, { at: number; durationMs: number; timer: ReturnType<typeof setTimeout> }>>,
): void {
  const details = evt.details as {
    invocation_id?: string;
    mcp_connection_id?: string;
    origin_doc_id?: string;
    duration_ms?: number;
  };
  const invId = details.invocation_id;
  const mcpId = details.mcp_connection_id;
  if (!invId || !mcpId) return;

  if (evt.eventType === 'invoke') {
    const pending = pendingCompletesRef.current.get(invId);
    const line: McpCallLine = {
      id: `mcp-${invId}`,
      invocationId: invId,
      originNodeId: details.origin_doc_id ?? null,
      mcpConnectionId: mcpId,
      agentId: evt.actorId,
      startedAt: evt.createdAt.getTime(),
      completedAt: pending ? pending.at : null,
    };
    if (pending) {
      clearTimeout(pending.timer);
      pendingCompletesRef.current.delete(invId);
    }
    inFlightRef.current.set(invId, line);
  } else if (evt.eventType === 'complete' || evt.eventType === 'error') {
    const existing = inFlightRef.current.get(invId);
    if (existing) {
      existing.completedAt = evt.createdAt.getTime();
    } else {
      // complete before invoke: buffer 2s, drop silently if invoke never arrives
      // (spec §10: no phantom return line with no origin)
      const timer = setTimeout(() => pendingCompletesRef.current.delete(invId), PENDING_COMPLETE_BUFFER_MS);
      pendingCompletesRef.current.set(invId, {
        at: evt.createdAt.getTime(),
        durationMs: details.duration_ms ?? 0,
        timer,
      });
    }
  }
}

function pruneMcpLines(
  inFlightRef: React.MutableRefObject<Map<string, McpCallLine>>,
): void {
  const now = Date.now();
  for (const [id, line] of inFlightRef.current) {
    const age = now - line.startedAt;
    if (line.completedAt === null && age > MCP_INVOKE_TTL_MS) {
      inFlightRef.current.delete(id);
    } else if (line.completedAt !== null && now - line.completedAt > MCP_RETURN_FADE_MS) {
      inFlightRef.current.delete(id);
    }
  }
}

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
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [mcpCallLines, setMcpCallLines] = useState<McpCallLine[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');

  const channelRef = useRef<RealtimeChannel | null>(null);
  const batcherRef = useRef<ReturnType<typeof createEventBatcher<BrainPulseEventBase>> | null>(null);
  const orphanRef = useRef<ReturnType<typeof createOrphanQueue<BrainPulseEventBase>> | null>(null);
  const knownNodeIdsRef = useRef<Set<string>>(new Set(input.seedGraph.nodes.map((n) => n.id)));
  const prevNodeIdsRef = useRef<Set<string>>(new Set(input.seedGraph.nodes.map((n) => n.id)));
  const pausedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Map<string, McpCallLine>>(new Map());
  const pendingCompletesRef = useRef<Map<string, { at: number; durationMs: number; timer: ReturnType<typeof setTimeout> }>>(new Map());

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

  // Prune expired pulses every 500ms so the buffer doesn't clog under low activity.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setPulses((prev) => {
        const alive = prev.filter((p) => now - p.createdAt < p.durationMs);
        return alive.length === prev.length ? prev : alive;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Prune expired MCP call lines every 500ms so they fade even between event batches.
  useEffect(() => {
    const interval = setInterval(() => {
      pruneMcpLines(inFlightRef);
      setMcpCallLines((prev) => {
        const current = Array.from(inFlightRef.current.values());
        // Shallow-compare length + id list to avoid unnecessary re-renders.
        if (current.length !== prev.length) return current;
        for (let i = 0; i < current.length; i++) if (current[i].id !== prev[i]?.id) return current;
        return prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Reset pulse buffer when re-subscribing (e.g. companyId change).
    setPulses([]);

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
        setPulses((prev) => {
          const now = Date.now();
          const fresh: Pulse[] = batch
            // delete pulses can reference about-to-leave nodes; other events require the
            // target to still be known. Ghost-node pulse (referencing already-deleted
            // nodes) is deferred to v2 — silently dropped here. TODO: v2
            .filter((e) => {
              if (e.targetType !== 'document' || !e.targetId) return false;
              if (e.category === 'document_mutation' && e.eventType === 'delete') return true;
              return knownNodeIdsRef.current.has(e.targetId);
            })
            .map((e) => ({
              id: `p-${e.id}`,
              nodeId: e.targetId!,
              agentId: e.actorId,
              category: e.category,
              eventType: e.eventType,
              createdAt: now,
              durationMs: pulseDurationFor(e),
            }));
          const alive = prev.filter((p) => now - p.createdAt < p.durationMs);
          return [...alive, ...fresh].slice(-MAX_CONCURRENT_PULSES);
        });
        // Process MCP events and snapshot in-flight lines for render.
        for (const e of batch) {
          if (e.category === 'mcp_invocation') processMcpEvent(e, inFlightRef, pendingCompletesRef);
        }
        pruneMcpLines(inFlightRef);
        setMcpCallLines(Array.from(inFlightRef.current.values()));
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
      for (const { timer } of pendingCompletesRef.current.values()) clearTimeout(timer);
      pendingCompletesRef.current.clear();
      inFlightRef.current.clear();
      setMcpCallLines([]);
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
    pulses,
    mcpCallLines,
    activeAgents,
    mcpConnections: graph.mcpConnections,
    eventRate60s,
    connectionStatus,
    graphError: graphError ?? null,
    retryGraph: () => { void revalidateGraph(); },
  };
}

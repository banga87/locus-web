'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { useBrainPulse } from '@/lib/brain-pulse/use-brain-pulse';
import { collapseEvents } from '@/lib/brain-pulse/event-formatters';
import type { GraphResponse } from '@/lib/graph/derive-graph';

import { NeuronCanvas } from './_components/neuron-canvas';
import { AgentSidebar } from './_components/agent-sidebar';
import { NarrativeStrip } from './_components/narrative-strip';
import { HudCounters } from './_components/hud-counters';
import { DocumentDrawer } from './_components/document-drawer';
import { EmptyState } from './_components/empty-state';

interface Props {
  brainId: string;
  companyId: string;
  seedGraph: GraphResponse;
}

export function NeuronsClient({ brainId, companyId, seedGraph }: Props) {
  const state = useBrainPulse({ brainId, companyId, seedGraph });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const visibleEvents = useMemo(
    () => (selectedAgentId ? state.events.filter((e) => e.actorId === selectedAgentId) : state.events),
    [state.events, selectedAgentId],
  );
  const lines = useMemo(() => collapseEvents(visibleEvents).slice(0, 30), [visibleEvents]);

  const mcpCounts = useMemo(() => {
    const out: Record<string, number> = {};
    const now = Date.now();
    for (const e of state.events) {
      if (e.category !== 'mcp_invocation' || e.eventType !== 'invoke') continue;
      if (now - e.createdAt.getTime() > 60_000) continue;
      const id = e.details.mcp_connection_id as string | undefined;
      if (!id) continue;
      out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }, [state.events]);

  if (seedGraph.nodes.length === 0) return <EmptyState variant="no-docs" />;
  if (state.graphError) return <EmptyState variant="error" onRetry={state.retryGraph} />;

  const isOversized = state.graph.nodes.length > 5000;

  return (
    <div className="neurons-root" data-connection-status={state.connectionStatus}>
      {isOversized && (
        <div className="neurons-banner neurons-banner--warn">
          This brain is large — performance may degrade.
          <Link href="/brain">Switch to list view</Link>
        </div>
      )}
      {state.connectionStatus === 'paused' && (
        <div className="neurons-banner">Live updates paused. Refresh to retry.</div>
      )}
      {state.connectionStatus === 'reconnecting' && <div className="neurons-chip">⟳ reconnecting</div>}

      <AgentSidebar
        agents={state.activeAgents}
        mcpConnections={state.mcpConnections}
        mcpCounts={mcpCounts}
        selectedAgentId={selectedAgentId}
        onSelect={setSelectedAgentId}
      />
      <div className="neurons-canvas-col">
        <HudCounters
          activeAgentCount={state.activeAgents.length}
          eventRate60s={state.eventRate60s}
          totalDocs={state.graph.nodes.length}
        />
        <NeuronCanvas
          graph={state.graph}
          pulses={state.pulses}
          mcpCallLines={state.mcpCallLines}
          mcpConnections={state.mcpConnections}
          soloAgentId={selectedAgentId}
          onNodeClick={(id) => { setSelectedDocId(id); setDrawerOpen(true); }}
        />
      </div>
      <NarrativeStrip lines={lines} />
      <DocumentDrawer open={drawerOpen} documentId={selectedDocId} onOpenChange={setDrawerOpen} />
    </div>
  );
}

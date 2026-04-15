'use client';

import { useBrainPulse } from '@/lib/brain-pulse/use-brain-pulse';
import type { GraphResponse } from '@/lib/graph/derive-graph';
import { EmptyState } from './_components/empty-state';

interface Props {
  brainId: string;
  companyId: string;
  seedGraph: GraphResponse;
}

export function NeuronsClient({ brainId, companyId, seedGraph }: Props) {
  const state = useBrainPulse({ brainId, companyId, seedGraph });
  if (seedGraph.nodes.length === 0) return <EmptyState variant="no-docs" />;
  if (state.graphError) return <EmptyState variant="error" onRetry={state.retryGraph} />;

  return (
    <div className="neurons-root" data-connection-status={state.connectionStatus}>
      {/* T12–T19 fill in HUD, sidebar, canvas, narrative, drawer */}
      <pre style={{ color: 'var(--ink)' }}>
        {state.events.length} events · {state.activeAgents.length} agents · status: {state.connectionStatus}
      </pre>
    </div>
  );
}

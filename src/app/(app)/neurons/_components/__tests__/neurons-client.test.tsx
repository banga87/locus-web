import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BrainPulseState } from '@/lib/brain-pulse/types';
import type { GraphResponse } from '@/lib/graph/derive-graph';

// Mock NeuronCanvas (dynamic ssr:false + canvas) with a stub that exposes
// onNodeClick as a button so we can fire it in tests.
vi.mock('../neuron-canvas', () => ({
  NeuronCanvas: ({ onNodeClick }: { onNodeClick?: (id: string) => void }) => (
    <button type="button" data-testid="mock-canvas" onClick={() => onNodeClick?.('doc-1')}>
      canvas
    </button>
  ),
}));

// Mock DocumentDrawer to avoid SWR + Sheet Portal complexity in tests.
vi.mock('../document-drawer', () => ({
  DocumentDrawer: ({ open, documentId }: { open: boolean; documentId: string | null }) =>
    open ? <div data-testid="mock-drawer">{documentId}</div> : null,
}));

const seedGraph: GraphResponse = {
  brain: { id: 'b1', slug: 'test-brain', name: 'Test' },
  nodes: [
    {
      id: 'n1', title: 'Doc 1', slug: 'doc-1', path: '/doc-1',
      folder_id: null, is_pinned: false, confidence_level: null, token_estimate: null,
    },
  ],
  edges: [],
  clusters: [],
  mcpConnections: [],
};
const emptySeedGraph: GraphResponse = { ...seedGraph, nodes: [] };

const mockState: BrainPulseState = {
  graph: seedGraph,
  events: [],
  pulses: [],
  mcpCallLines: [],
  activeAgents: [
    { id: 'a1', type: 'agent_token', name: 'Marketing', countLast60s: 7, color: { css: '#7aa7ff', canvas: '#7aa7ff' }, lastSeenAt: Date.now() },
  ],
  mcpConnections: [],
  eventRate60s: 3,
  connectionStatus: 'connected',
  graphError: null,
  retryGraph: vi.fn(),
};

// Mock useBrainPulse so tests don't touch Supabase or SWR.
vi.mock('@/lib/brain-pulse/use-brain-pulse', () => ({
  useBrainPulse: vi.fn(() => mockState),
}));

// Import NeuronsClient after all mocks are registered.
import { NeuronsClient } from '../../neurons-client';
import { useBrainPulse } from '@/lib/brain-pulse/use-brain-pulse';

describe('NeuronsClient', () => {
  beforeEach(() => {
    vi.mocked(useBrainPulse).mockReturnValue(mockState);
  });

  it('renders HudCounters pills with live state values', () => {
    render(<NeuronsClient brainId="b1" companyId="c1" seedGraph={seedGraph} />);
    expect(screen.getByText(/1 agents/i)).toBeInTheDocument();
    expect(screen.getByText(/3 events · 60s/i)).toBeInTheDocument();
    expect(screen.getByText(/1 docs/i)).toBeInTheDocument();
  });

  it('renders empty-state when seedGraph has no nodes', () => {
    render(<NeuronsClient brainId="b1" companyId="c1" seedGraph={emptySeedGraph} />);
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
  });

  it('renders error-state when graphError is truthy', () => {
    vi.mocked(useBrainPulse).mockReturnValueOnce({ ...mockState, graphError: new Error('boom') });
    render(<NeuronsClient brainId="b1" companyId="c1" seedGraph={seedGraph} />);
    expect(screen.getByText(/can't load/i)).toBeInTheDocument();
  });

  it('clicking a canvas node opens the document drawer', () => {
    render(<NeuronsClient brainId="b1" companyId="c1" seedGraph={seedGraph} />);
    expect(screen.queryByTestId('mock-drawer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mock-canvas'));
    const drawer = screen.getByTestId('mock-drawer');
    expect(drawer).toBeInTheDocument();
    expect(drawer.textContent).toBe('doc-1');
  });
});

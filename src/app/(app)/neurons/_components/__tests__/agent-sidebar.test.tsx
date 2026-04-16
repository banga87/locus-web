import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentSidebar } from '../agent-sidebar';

const agents = [
  {
    id: 'a1',
    type: 'agent_token' as const,
    name: 'Marketing',
    countLast60s: 5,
    color: { css: '#7aa7ff', canvas: '#7aa7ff' },
    lastSeenAt: Date.now(),
  },
  {
    id: 'a2',
    type: 'human' as const,
    name: 'Jesse',
    countLast60s: 2,
    color: { css: '#f6a06a', canvas: '#f6a06a' },
    lastSeenAt: Date.now(),
  },
];

const mcps = [
  { id: 'm1', name: 'Stripe', status: 'active' as const, server_url_host: 'stripe.com' },
];

describe('AgentSidebar', () => {
  it('renders each agent with name and count', () => {
    render(
      <AgentSidebar
        agents={agents}
        mcpConnections={mcps}
        selectedAgentId={null}
        onSelect={() => {}}
        mcpCounts={{}}
      />,
    );
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Jesse')).toBeInTheDocument();
    expect(screen.getByText('Stripe')).toBeInTheDocument();
  });

  it('calls onSelect with agent id when clicked', () => {
    const onSelect = vi.fn();
    render(
      <AgentSidebar
        agents={agents}
        mcpConnections={mcps}
        selectedAgentId={null}
        onSelect={onSelect}
        mcpCounts={{}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /marketing/i }));
    expect(onSelect).toHaveBeenCalledWith('a1');
  });

  it('clicking View All clears solo selection', () => {
    const onSelect = vi.fn();
    render(
      <AgentSidebar
        agents={agents}
        mcpConnections={mcps}
        selectedAgentId="a1"
        onSelect={onSelect}
        mcpCounts={{}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /view all/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('marks MCP with error status via data attribute', () => {
    const errMcps = [
      { id: 'm2', name: 'Broken', status: 'error' as const, server_url_host: 'broken.co' },
    ];
    render(
      <AgentSidebar
        agents={[]}
        mcpConnections={errMcps}
        selectedAgentId={null}
        onSelect={() => {}}
        mcpCounts={{}}
      />,
    );
    expect(screen.getByTestId('mcp-row-m2').dataset.status).toBe('error');
  });
});

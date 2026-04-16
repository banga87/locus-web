import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudCounters } from '../hud-counters';

describe('HudCounters', () => {
  it('renders counts for agents, events, docs', () => {
    render(<HudCounters activeAgentCount={3} eventRate60s={12} totalDocs={54} />);
    expect(screen.getByText(/3 agents/i)).toBeInTheDocument();
    expect(screen.getByText(/12 events · 60s/i)).toBeInTheDocument();
    expect(screen.getByText(/54 docs/i)).toBeInTheDocument();
  });
});

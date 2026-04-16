import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NarrativeStrip } from '../narrative-strip';
import type { NarrativeLine } from '@/lib/brain-pulse/event-formatters';

const now = Date.now();

describe('NarrativeStrip', () => {
  it('renders a clickable link for a valid doc path', () => {
    const lines: NarrativeLine[] = [
      {
        id: 'l1',
        type: 'event',
        text: 'Marketing read /ops/pricing-tiers',
        docPath: '/ops/pricing-tiers',
        createdAt: now,
        actorId: 'a1',
      },
    ];
    render(<NarrativeStrip lines={lines} />);
    const link = screen.getByRole('link', { name: /\/ops\/pricing-tiers/ });
    expect(link.getAttribute('href')).toMatch(/\/ops\/pricing-tiers/);
  });

  it('renders plain text for lines with null docPath', () => {
    const lines: NarrativeLine[] = [
      {
        id: 'l1',
        type: 'event',
        text: 'Marketing did a thing',
        docPath: null,
        createdAt: now,
        actorId: 'a1',
      },
    ];
    render(<NarrativeStrip lines={lines} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/Marketing did a thing/)).toBeInTheDocument();
  });

  it('shows empty hint when no lines', () => {
    render(<NarrativeStrip lines={[]} />);
    expect(screen.getByText(/Waiting for agent activity/i)).toBeInTheDocument();
  });

  it('marks aggregate lines with data-type=aggregate', () => {
    const lines: NarrativeLine[] = [
      {
        id: 'agg-1',
        type: 'aggregate',
        text: 'Maintenance · touched 40 docs in /product',
        docPath: null,
        createdAt: now,
        actorId: 'm1',
      },
    ];
    render(<NarrativeStrip lines={lines} />);
    const container = screen.getByText(/Maintenance/).closest('[data-type]');
    expect(container?.getAttribute('data-type')).toBe('aggregate');
  });
});

// Streaming indicator render test. Plain visual contract — three dots,
// announced as a status to assistive tech.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StreamingIndicator } from '@/components/chat/streaming-indicator';

describe('StreamingIndicator', () => {
  it('exposes a polite live-region for screen readers', () => {
    render(<StreamingIndicator />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-label', 'Assistant is responding');
  });

  it('renders three animated dots', () => {
    const { container } = render(<StreamingIndicator />);
    const dots = container.querySelectorAll('span[aria-hidden="true"]');
    expect(dots.length).toBe(3);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Brain } from 'lucide-react';

import { Section } from '@/components/shell/sidebar/section';

describe('<Section>', () => {
  it('renders label and count', () => {
    render(
      <Section id="brain" icon={Brain} label="Brain" count={42} expanded onToggle={() => {}}>
        <div>inner</div>
      </Section>
    );
    expect(screen.getByText('Brain')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('reveals children when expanded, hides when collapsed', () => {
    const { rerender } = render(
      <Section id="brain" icon={Brain} label="Brain" expanded onToggle={() => {}}>
        <div data-testid="body">inner</div>
      </Section>
    );
    expect(screen.getByTestId('body')).toBeVisible();

    rerender(
      <Section id="brain" icon={Brain} label="Brain" expanded={false} onToggle={() => {}}>
        <div data-testid="body">inner</div>
      </Section>
    );
    // aria-expanded reflects state; body element is hidden via hidden attr or aria
    const header = screen.getByRole('button', { name: /brain/i });
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('calls onToggle when header is clicked', () => {
    const onToggle = vi.fn();
    render(
      <Section id="brain" icon={Brain} label="Brain" expanded onToggle={onToggle}>
        <div>inner</div>
      </Section>
    );
    fireEvent.click(screen.getByRole('button', { name: /brain/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders an optional headerAction slot that does not trigger onToggle', () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    render(
      <Section
        id="brain"
        icon={Brain}
        label="Brain"
        expanded
        onToggle={onToggle}
        headerAction={<button onClick={onAction} aria-label="Add">+</button>}
      >
        <div>inner</div>
      </Section>
    );
    fireEvent.click(screen.getByLabelText('Add'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('wires aria-controls to body id', () => {
    render(
      <Section id="brain" icon={Brain} label="Brain" expanded onToggle={() => {}}>
        <div>inner</div>
      </Section>
    );
    const header = screen.getByRole('button', { name: /brain/i });
    const bodyId = header.getAttribute('aria-controls');
    expect(bodyId).toBeTruthy();
    expect(document.getElementById(bodyId!)).not.toBeNull();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ResizeHandle } from '@/components/shell/sidebar/resize-handle';
import { __resetForTest } from '@/lib/sidebar/use-sidebar-layout';

beforeEach(() => {
  __resetForTest();
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

describe('<ResizeHandle>', () => {
  it('renders as a separator with correct aria', () => {
    render(<ResizeHandle />);
    const handle = screen.getByRole('separator', { name: /resize sidebar/i });
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe('220');
    expect(handle.getAttribute('aria-valuemax')).toBe('480');
    expect(handle.getAttribute('aria-valuenow')).toBe('280');
  });

  it('ArrowRight increases width by 8', () => {
    render(<ResizeHandle />);
    const handle = screen.getByRole('separator');
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('288');
  });

  it('ArrowLeft decreases width by 8', () => {
    render(<ResizeHandle />);
    const handle = screen.getByRole('separator');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuenow')).toBe('272');
  });

  it('Home jumps to min, End to max', () => {
    render(<ResizeHandle />);
    const handle = screen.getByRole('separator');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle.getAttribute('aria-valuenow')).toBe('220');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle.getAttribute('aria-valuenow')).toBe('480');
  });

  it('double-click resets to default 280', () => {
    render(<ResizeHandle />);
    const handle = screen.getByRole('separator');
    fireEvent.keyDown(handle, { key: 'End' }); // width = 480
    fireEvent.doubleClick(handle);
    expect(handle.getAttribute('aria-valuenow')).toBe('280');
  });
});

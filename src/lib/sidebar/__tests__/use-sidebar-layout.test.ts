import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useSidebarLayout, __resetForTest } from '@/lib/sidebar/use-sidebar-layout';

const KEY = 'locus.sidebar.v1';

beforeEach(() => {
  // Module-level store is shared across tests — reset or tests leak state.
  __resetForTest();
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

describe('useSidebarLayout', () => {
  it('returns defaults on first use', () => {
    const { result } = renderHook(() => useSidebarLayout());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.width).toBe(280);
    expect(result.current.sections).toEqual({ brain: true, pinned: true });
  });

  it('writes --sidebar-width to documentElement', () => {
    const { result } = renderHook(() => useSidebarLayout());
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('280px');
    act(() => result.current.setWidth(320));
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('320px');
  });

  it('clamps width to [220, 480] on setWidth', () => {
    const { result } = renderHook(() => useSidebarLayout());
    act(() => result.current.setWidth(100));
    expect(result.current.width).toBe(220);
    act(() => result.current.setWidth(999));
    expect(result.current.width).toBe(480);
  });

  it('reports effective width of 56 when collapsed', () => {
    const { result } = renderHook(() => useSidebarLayout());
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(true);
    expect(result.current.width).toBe(56);
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('56px');
  });

  it('persists state to localStorage under the versioned key', () => {
    const { result } = renderHook(() => useSidebarLayout());
    act(() => result.current.setWidth(340));
    act(() => result.current.toggleSection('brain'));
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.width).toBe(340);
    expect(stored.sections.brain).toBe(false);
  });

  it('hydrates from localStorage on mount', () => {
    localStorage.setItem(KEY, JSON.stringify({
      collapsed: true,
      width: 400,
      sections: { brain: false, pinned: true, workflows: true },
    }));
    const { result } = renderHook(() => useSidebarLayout());
    expect(result.current.collapsed).toBe(true);
    expect(result.current.width).toBe(56); // effective (collapsed)
    expect(result.current.sections.workflows).toBe(true);
  });

  it('falls back to defaults on parse failure', () => {
    localStorage.setItem(KEY, '{malformed json');
    const { result } = renderHook(() => useSidebarLayout());
    expect(result.current.width).toBe(280);
    expect(result.current.collapsed).toBe(false);
  });

  it('expandSidebarWithSection opens only that section', () => {
    const { result } = renderHook(() => useSidebarLayout());
    // Start collapsed, two sections open
    act(() => {
      result.current.toggleCollapsed();
      result.current.toggleSection('pinned'); // turn it off
      result.current.toggleSection('pinned'); // on
    });
    act(() => result.current.expandSidebarWithSection('pinned'));
    expect(result.current.collapsed).toBe(false);
    expect(result.current.sections.pinned).toBe(true);
    expect(result.current.sections.brain).toBe(false);
  });

  it('toggleSection flips only the target section', () => {
    const { result } = renderHook(() => useSidebarLayout());
    act(() => result.current.toggleSection('brain'));
    expect(result.current.sections.brain).toBe(false);
    expect(result.current.sections.pinned).toBe(true);
  });
});

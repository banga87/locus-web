'use client';

import { useSyncExternalStore, useCallback } from 'react';

const STORAGE_KEY = 'locus.sidebar.v1';
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 280;
const RAIL_WIDTH = 56;

type SidebarState = {
  collapsed: boolean;
  width: number;
  sections: Record<string, boolean>;
};

const DEFAULT_STATE: SidebarState = {
  collapsed: false,
  width: DEFAULT_WIDTH,
  sections: { brain: true, pinned: true },
};

function clampWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(n)));
}

function readStored(): SidebarState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_STATE;
    return {
      collapsed: typeof parsed.collapsed === 'boolean' ? parsed.collapsed : DEFAULT_STATE.collapsed,
      width: clampWidth(typeof parsed.width === 'number' ? parsed.width : DEFAULT_WIDTH),
      sections: parsed.sections && typeof parsed.sections === 'object'
        ? {
            ...DEFAULT_STATE.sections,
            ...Object.fromEntries(
              (Object.entries(parsed.sections) as [string, unknown][])
                .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
            ),
          }
        : DEFAULT_STATE.sections,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeStored(state: SidebarState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota / private mode — in-memory state still works
  }
}

// Module-level store so multiple components share one source of truth
// without needing a Provider. Reads are cheap; writes re-notify.
let currentState: SidebarState = DEFAULT_STATE;
let hydrated = false;
const listeners = new Set<() => void>();

function ensureHydrated() {
  if (hydrated) return;
  currentState = readStored();
  hydrated = true;
  // Do NOT call applyCssVar here — ensureHydrated runs inside
  // getSnapshot which must be a pure read. CSS var writes happen
  // in setState (on every update) and in ensureSidebarHydrated
  // (which SidebarLayoutBoot calls in a useLayoutEffect).
}

function applyCssVar(state: SidebarState) {
  if (typeof document === 'undefined') return;
  const effective = state.collapsed ? RAIL_WIDTH : state.width;
  document.documentElement.style.setProperty('--sidebar-width', `${effective}px`);
  const app = document.querySelector('.app');
  if (app) {
    if (state.collapsed) app.setAttribute('data-sidebar-collapsed', 'true');
    else app.removeAttribute('data-sidebar-collapsed');
  }
}

function setState(updater: (prev: SidebarState) => SidebarState) {
  ensureHydrated();
  currentState = updater(currentState);
  writeStored(currentState);
  applyCssVar(currentState);
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): SidebarState {
  ensureHydrated();
  return currentState;
}

function getServerSnapshot(): SidebarState {
  return DEFAULT_STATE;
}

export type SidebarLayoutApi = {
  collapsed: boolean;
  width: number;
  sections: Record<string, boolean>;
  toggleCollapsed: () => void;
  setWidth: (px: number) => void;
  toggleSection: (id: string) => void;
  expandSidebarWithSection: (id: string) => void;
};

export function useSidebarLayout(): SidebarLayoutApi {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleCollapsed = useCallback(() => {
    setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  const setWidth = useCallback((px: number) => {
    setState((prev) => ({ ...prev, width: clampWidth(px) }));
  }, []);

  const toggleSection = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      sections: { ...prev.sections, [id]: !prev.sections[id] },
    }));
  }, []);

  const expandSidebarWithSection = useCallback((id: string) => {
    setState((prev) => {
      const nextSections: Record<string, boolean> = {};
      for (const key of Object.keys(prev.sections)) nextSections[key] = false;
      nextSections[id] = true;
      return { ...prev, collapsed: false, sections: nextSections };
    });
  }, []);

  return {
    collapsed: state.collapsed,
    width: state.collapsed ? RAIL_WIDTH : state.width,
    sections: state.sections,
    toggleCollapsed,
    setWidth,
    toggleSection,
    expandSidebarWithSection,
  };
}

// Exposed for SidebarLayoutBoot which calls this in a useLayoutEffect
// to force rehydration after the component mounts (getServerSnapshot
// returns defaults during SSR; the real state is read on first client
// snapshot call). This is mostly defensive — reading getSnapshot() is
// enough to trigger hydration.
export function ensureSidebarHydrated(): void {
  ensureHydrated();
  applyCssVar(currentState);
  listeners.forEach((fn) => fn());
}

// Test-only: reset module-level store. MUST be called in beforeEach for
// any test that interacts with the hook, or state leaks between tests.
// (The `useSyncExternalStore` pattern relies on a shared module-scoped
// store; there is no per-render reset, so tests need an escape hatch.)
export function __resetForTest(): void {
  currentState = DEFAULT_STATE;
  hydrated = false;
  listeners.clear();
  if (typeof document !== 'undefined') {
    document.documentElement.style.removeProperty('--sidebar-width');
    document.querySelector('.app')?.removeAttribute('data-sidebar-collapsed');
  }
}

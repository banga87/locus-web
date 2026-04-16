import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import type { GraphResponse } from '@/lib/graph/derive-graph';
import { useBrainPulse } from '../use-brain-pulse';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
    {children}
  </SWRConfig>
);

function makeFakeSupabase() {
  const channels: Array<{ handler: (p: { new: Record<string, unknown> }) => void; unsubscribed: boolean }> = [];
  const statusCallbacks: Array<(status: string) => void> = [];
  const client = {
    // useBrainPulse gates channel.join() behind auth.getSession() + realtime.setAuth
    // so Realtime joins carry the user's JWT. Tests mirror that: the promise
    // resolves synchronously on the microtask queue so the channel is created
    // before assertions run.
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
    },
    realtime: {
      setAuth: (_token: string | null) => {},
    },
    channel(_name: string) {
      const ctx: { handler: (p: { new: Record<string, unknown> }) => void; unsubscribed: boolean } = {
        handler: () => {}, unsubscribed: false,
      };
      channels.push(ctx);
      const api = {
        on(_event: string, _opts: unknown, handler: (p: { new: Record<string, unknown> }) => void) {
          ctx.handler = handler; return api;
        },
        subscribe(cb?: (status: string) => void) {
          if (cb) { statusCallbacks.push(cb); setTimeout(() => cb('SUBSCRIBED'), 0); }
          return api;
        },
        unsubscribe() { ctx.unsubscribed = true; return Promise.resolve('ok'); },
      };
      return api;
    },
    removeChannel(_c: unknown) {},
  };
  return {
    client,
    emit(row: Record<string, unknown>) { for (const c of channels) if (!c.unsubscribed) c.handler({ new: row }); },
    fireStatus(s: string) { for (const cb of statusCallbacks) cb(s); },
    channels,
  };
}

const seed: GraphResponse = {
  brain: { id: 'b1', slug: 'acme', name: 'Acme' },
  nodes: [{ id: 'd1', title: 'A', slug: 'a', path: '/a', folder_id: null, is_pinned: false, confidence_level: null, token_estimate: null }],
  edges: [], clusters: [], mcpConnections: [],
};

describe('useBrainPulse', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the seed graph immediately', () => {
    const fake = makeFakeSupabase();
    const { result } = renderHook(
      () => useBrainPulse({ brainId: 'b1', companyId: 'c1', seedGraph: seed, supabaseClient: fake.client as never }),
      { wrapper },
    );
    expect(result.current.graph).toEqual(seed);
    expect(result.current.events).toEqual([]);
  });

  it('ingests a Realtime INSERT and surfaces it after a batcher flush', async () => {
    const fake = makeFakeSupabase();
    const { result } = renderHook(
      () => useBrainPulse({ brainId: 'b1', companyId: 'c1', seedGraph: seed, supabaseClient: fake.client as never }),
      { wrapper },
    );
    // Channel creation is now gated on auth.getSession() — wait for it to register.
    await waitFor(() => expect(fake.channels).toHaveLength(1));
    act(() => {
      fake.emit({
        id: 'e-1', created_at: new Date().toISOString(),
        company_id: 'c1', brain_id: 'b1',
        actor_type: 'agent_token', actor_id: 'ag-1', actor_name: 'Marketing',
        target_type: 'document', target_id: 'd1',
        category: 'document_access', event_type: 'document.read',
        details: { path: '/a' },
      });
      vi.advanceTimersByTime(120);
    });
    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].actorName).toBe('Marketing');
    });
  });

  it('filters out excluded categories (authentication)', async () => {
    const fake = makeFakeSupabase();
    const { result } = renderHook(
      () => useBrainPulse({ brainId: 'b1', companyId: 'c1', seedGraph: seed, supabaseClient: fake.client as never }),
      { wrapper },
    );
    await waitFor(() => expect(fake.channels).toHaveLength(1));
    act(() => {
      fake.emit({
        id: 'e-auth', created_at: new Date().toISOString(),
        company_id: 'c1', brain_id: 'b1',
        actor_type: 'human', actor_id: 'u1', actor_name: 'Jane',
        target_type: null, target_id: null,
        category: 'authentication', event_type: 'auth.login', details: {},
      });
      vi.advanceTimersByTime(200);
    });
    expect(result.current.events).toEqual([]);
  });

  it('unsubscribes the channel on unmount', async () => {
    const fake = makeFakeSupabase();
    const { unmount } = renderHook(
      () => useBrainPulse({ brainId: 'b1', companyId: 'c1', seedGraph: seed, supabaseClient: fake.client as never }),
      { wrapper },
    );
    await waitFor(() => expect(fake.channels).toHaveLength(1));
    unmount();
    expect(fake.channels[0].unsubscribed).toBe(true);
  });

  it('re-subscribes when companyId changes (cross-company switch)', async () => {
    const fake = makeFakeSupabase();
    const { rerender } = renderHook(
      ({ companyId }: { companyId: string }) =>
        useBrainPulse({ brainId: 'b1', companyId, seedGraph: seed, supabaseClient: fake.client as never }),
      { wrapper, initialProps: { companyId: 'c1' } },
    );
    await waitFor(() => expect(fake.channels).toHaveLength(1));
    rerender({ companyId: 'c2' });
    await waitFor(() => expect(fake.channels).toHaveLength(2));
    expect(fake.channels[0].unsubscribed).toBe(true);
  });

  it('updates connectionStatus to reconnecting on CHANNEL_ERROR and paused after 60s', async () => {
    const fake = makeFakeSupabase();
    const { result } = renderHook(
      () => useBrainPulse({ brainId: 'b1', companyId: 'c1', seedGraph: seed, supabaseClient: fake.client as never }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.connectionStatus).toBe('connected'));
    act(() => { fake.fireStatus('CHANNEL_ERROR'); });
    expect(result.current.connectionStatus).toBe('reconnecting');
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.connectionStatus).toBe('paused');
  });
});

// SessionSidebar tests — focused on the optimistic insert behaviour
// after "New chat". We stub `fetch` so the POST resolves deterministically
// without a server, and assert that the newly-created session appears in
// the list BEFORE any revalidation fires.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

// next/navigation's useRouter wants the App Router mount context; we
// mock it to a no-op push so the test environment doesn't need a live
// router. We capture calls so the test can assert on navigation too.
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { SessionSidebar } from '@/components/chat/session-sidebar';

type SessionItem = {
  id: string;
  status: 'active' | 'completed';
  turnCount: number;
  firstMessage: string | null;
  createdAt: string;
  lastActiveAt: string;
  totalTokens: number;
};

function buildListResponse(items: SessionItem[]) {
  return {
    success: true,
    data: items,
    pagination: { nextCursor: null },
  };
}

describe('SessionSidebar', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    routerPush.mockClear();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderSidebar() {
    // Dedicated SWR provider so cache doesn't leak between tests.
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SessionSidebar activeSessionId={null} />
      </SWRConfig>,
    );
  }

  it('optimistically prepends a new session after clicking New chat', async () => {
    // Initial list: one existing session.
    const existing: SessionItem = {
      id: 'existing-1',
      status: 'active',
      turnCount: 3,
      firstMessage: 'First question',
      createdAt: '2026-04-10T00:00:00.000Z',
      lastActiveAt: '2026-04-12T00:00:00.000Z',
      totalTokens: 42,
    };

    // Control POST timing with a deferred promise so we can assert
    // intermediate UI state.
    let resolvePost: (value: unknown) => void = () => {};
    const postPromise = new Promise((res) => {
      resolvePost = res;
    });

    fetchMock.mockImplementation(
      async (url: string, init?: { method?: string }) => {
        if (url === '/api/agent/sessions' && (!init || init.method !== 'POST')) {
          return {
            ok: true,
            json: async () => buildListResponse([existing]),
          };
        }
        if (url === '/api/agent/sessions' && init?.method === 'POST') {
          await postPromise;
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                id: 'new-2',
                status: 'active',
                turnCount: 0,
                firstMessage: null,
                createdAt: '2026-04-13T00:00:00.000Z',
                lastActiveAt: '2026-04-13T00:00:00.000Z',
                totalTokens: 0,
              },
            }),
          };
        }
        throw new Error(`Unmocked fetch: ${url}`);
      },
    );

    renderSidebar();

    // Wait for the initial list to render.
    await screen.findByText('First question');

    // Click New chat. The POST is still pending; `fetch` returns a
    // promise that hasn't resolved yet.
    fireEvent.click(screen.getByLabelText('New chat'));

    // Resolve the POST so the optimistic insert fires.
    resolvePost({});

    // Wait for the "New conversation" placeholder row (firstMessage is
    // null on brand-new sessions) to appear BEFORE the revalidation
    // fetch lands. The optimistic update is synchronous after the POST
    // response, so this should resolve quickly and deterministically.
    await waitFor(() => {
      expect(screen.getByText('New conversation')).toBeInTheDocument();
    });

    // Existing session is still rendered; new session was prepended.
    expect(screen.getByText('First question')).toBeInTheDocument();

    // Navigation fired to the new session's URL.
    expect(routerPush).toHaveBeenCalledWith('/chat/new-2');
  });
});

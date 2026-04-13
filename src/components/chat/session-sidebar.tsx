'use client';

// Session sidebar. Lists the current user's prior chat sessions and
// highlights the active one. Powered by SWR so that a newly-created
// session that appears in the list after navigation shows up without a
// hard reload.
//
// Fetch: GET /api/agent/sessions. Response envelope is the paginated
// API shape — { success, data, pagination } — so we unwrap `.data`.
//
// Click behaviour: <Link href="/chat/[id]"> — Next.js client-side
// navigation, no full page reload.
//
// "New chat" button posts to /api/agent/sessions and navigates to the
// created session. We route through the POST endpoint directly rather
// than the /chat server redirect so we can mutate the SWR cache
// immediately and not wait for the next revalidation.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDistance } from '@/lib/format/time';

interface SessionListItem {
  id: string;
  status: 'active' | 'completed';
  turnCount: number;
  firstMessage: string | null;
  createdAt: string;
  lastActiveAt: string;
  totalTokens: number;
}

interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: { nextCursor: string | null; total?: number };
}

const fetcher = async (url: string): Promise<SessionListItem[]> => {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`sessions_request_failed_${res.status}`);
  }
  const json = (await res.json()) as PaginatedResponse<SessionListItem>;
  return json.data ?? [];
};

interface SessionSidebarProps {
  activeSessionId: string | null;
  /** Called after a session list item (or "New chat") is clicked. Used on mobile to close the drawer. */
  onNavigate?: () => void;
  className?: string;
}

export function SessionSidebar({
  activeSessionId,
  onNavigate,
  className,
}: SessionSidebarProps) {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<SessionListItem[]>(
    '/api/agent/sessions',
    fetcher,
    {
      // Refresh when the user returns to the tab — someone might have
      // created a session in a different window.
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    },
  );

  const handleNewChat = async () => {
    try {
      const res = await fetch('/api/agent/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`create_failed_${res.status}`);
      const json = (await res.json()) as {
        success: true;
        data: { id: string };
      };
      await mutate(); // pull the new session into the list
      onNavigate?.();
      router.push(`/chat/${json.data.id}`);
    } catch (err) {
      console.error('[chat] create session failed', err);
    }
  };

  return (
    <aside
      className={cn(
        'flex h-full w-full flex-col border-r border-border bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <span className="text-sm font-medium">Chats</span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="New chat"
          onClick={handleNewChat}
        >
          <PlusIcon className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            Loading sessions…
          </div>
        )}

        {error && !isLoading && (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            Couldn&apos;t load sessions.{' '}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => mutate()}
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && data && data.length === 0 && (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            No chats yet. Start one with the + button above.
          </div>
        )}

        <ul className="flex flex-col gap-0.5 p-2">
          {data?.map((session) => (
            <li key={session.id}>
              <SessionRow
                session={session}
                isActive={session.id === activeSessionId}
                onClick={onNavigate}
              />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  isActive,
  onClick,
}: {
  session: SessionListItem;
  isActive: boolean;
  onClick?: () => void;
}) {
  const preview = session.firstMessage?.trim()
    ? truncate(session.firstMessage, 60)
    : 'New conversation';
  const rel = formatDistance(session.lastActiveAt);

  return (
    <Link
      href={`/chat/${session.id}`}
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition-colors',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'hover:bg-sidebar-accent/60 text-sidebar-foreground',
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium">{preview}</span>
        {session.status === 'completed' && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            done
          </span>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground">{rel}</span>
    </Link>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

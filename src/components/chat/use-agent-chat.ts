'use client';

// Thin wrapper around `useChat` from `@ai-sdk/react`. Centralises the
// transport configuration so every chat surface posts to the same route
// and threads the active session id into the request body.
//
// `id` is set to `sessionId` so multi-tab usage of the same session
// shares state across mounts (the AI SDK keys its in-memory chat store
// by `id`). `null` means "no session yet" — Task 4 will make sure the
// /chat redirect creates a session before any UI renders.
//
// `transport` is memoised on `sessionId` so re-renders of the consuming
// component don't hand `useChat` a fresh transport instance each pass
// (which would thrash the SDK's internal subscriptions). The identity
// only needs to change when we legitimately switch sessions.

import { useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export function useAgentChat(sessionId: string | null) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/agent/chat',
        body: { sessionId },
      }),
    [sessionId],
  );
  return useChat({
    id: sessionId ?? undefined,
    transport,
  });
}

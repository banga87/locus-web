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
// Phase 1 keeps this wrapper minimal — Task 4 layers on the actual UI
// components that consume `messages`, `sendMessage`, `status`, `stop`.

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export function useAgentChat(sessionId: string | null) {
  return useChat({
    id: sessionId ?? undefined,
    transport: new DefaultChatTransport({
      api: '/api/agent/chat',
      body: { sessionId },
    }),
  });
}

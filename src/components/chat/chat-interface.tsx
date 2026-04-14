'use client';

// Top-level Client Component that hosts a single chat session. Wires
// together: useAgentChat (transport + state), the message stream, the
// streaming indicator, the input, and the error UX.
//
// === Architectural decision: AI Elements scope ===
// We use `MessageResponse` from @/components/ai-elements/message (the
// Streamdown-backed markdown renderer) inside MessageBubble — it
// handles incremental streaming markdown safely, which is the standard
// recommendation for `useChat` text parts.
//
// We did NOT adopt the larger `<Conversation>` / `<Message>` shell
// because (a) every Locus tool is bridged through `dynamicTool()`
// (see `src/lib/agent/tool-bridge.ts` and `src/lib/mcp-out/bridge.ts`),
// so we render `dynamic-tool` parts with a custom `ToolCallIndicator`
// that knows about our brain-tool naming and per-state UX (pending /
// pill / muted-error); (b) the layout is custom — session sidebar,
// stop button styling, three-dot indicator, scroll-to-bottom — and
// the wrapper components compose against Radix-flavoured primitives
// while this codebase ships `@base-ui/react`. The narrow
// MessageResponse import gives us the safe markdown path without
// conflating two component systems.
// ============================================================================

import { useMemo, useRef, useState, useEffect } from 'react';
import { AlertCircleIcon, RefreshCwIcon } from 'lucide-react';
import type { UIMessage } from 'ai';

import { Button } from '@/components/ui/button';
import { useAgentChat } from '@/components/chat/use-agent-chat';

import { ChatContainer } from './chat-container';
import { ChatInput } from './chat-input';
import { MessageBubble } from './message-bubble';
import { StreamingIndicator } from './streaming-indicator';

interface ChatInterfaceProps {
  sessionId: string;
  /** Messages reconstructed from `session_turns` for SSR — empty for a brand-new session. */
  initialMessages: UIMessage[];
}

export function ChatInterface({
  sessionId,
  initialMessages,
}: ChatInterfaceProps) {
  // useAgentChat returns the full useChat helpers — pull what we need.
  // `setMessages` is a first-class field on the v6 UseChatHelpers
  // surface (see `@ai-sdk/react` types), so no cast is required.
  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    error,
    clearError,
    setMessages,
  } = useAgentChat(sessionId);

  // Hydrate the AI SDK store from server-rendered turns ONCE on mount.
  // useChat doesn't expose an `initialMessages` option in v6 the way it
  // did in v4 — we splice them in via `setMessages`. A ref (not state)
  // tracks "already done" so the effect doesn't trigger a cascading
  // re-render: hydration is a fire-and-forget side effect; useChat's
  // own state owns the messages from there on.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (initialMessages.length === 0) return;
    setMessages(initialMessages);
  }, [initialMessages, setMessages]);

  const [draft, setDraft] = useState('');

  const isStreaming = status === 'submitted' || status === 'streaming';

  // streamTick — increments whenever the message stream advances. The
  // ChatContainer uses it to decide whether to auto-scroll.
  const streamTick = useMemo(() => {
    let tick = messages.length;
    // Add a per-character signal off the last assistant message so
    // mid-stream token deltas keep us pinned to the bottom (provided
    // the user hasn't scrolled up).
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant') {
      const text = last.parts
        .map((p) => (p.type === 'text' ? (p as { text: string }).text : ''))
        .join('');
      tick += text.length;
    }
    return tick;
  }, [messages]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    if (isStreaming) return;
    if (status === 'error') {
      // User started typing again after an error — clear the error
      // state so the next request starts fresh.
      clearError();
    }
    sendMessage({ text });
    setDraft('');
  };

  const handleRetry = async () => {
    clearError();
    try {
      await regenerate();
    } catch (err) {
      // regenerate() rejects on transport-level errors; SDK already
      // sets `error` so the UI will render the retry block again.
      console.warn('[chat] regenerate failed', err);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ChatContainer streamTick={streamTick}>
        {messages.length === 0 && !isStreaming && (
          <EmptyState />
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {/* Show the typing indicator after send, before the first token
            lands. Once the assistant message exists with text, the
            bubble itself is the visible "I'm responding" signal. */}
        {status === 'submitted' && (
          <div className="flex w-full justify-start">
            <StreamingIndicator />
          </div>
        )}

        {status === 'error' && (
          <ErrorBlock
            message={error?.message}
            onRetry={handleRetry}
          />
        )}
      </ChatContainer>

      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <ChatInput
            value={draft}
            onChange={setDraft}
            onSubmit={handleSend}
            onStop={() => stop()}
            isStreaming={isStreaming}
            sessionId={sessionId}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-12 max-w-md text-center text-sm text-muted-foreground">
      <p>Ask anything about your brain — search, summarise, draft.</p>
      <p className="mt-2 text-xs">
        The agent has read access to your documents and any connected MCP
        servers.
      </p>
    </div>
  );
}

function ErrorBlock({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-md items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <AlertCircleIcon
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <div className="flex-1 space-y-2">
        <p className="text-foreground">
          The agent ran into a problem.
          {message ? (
            <span className="block text-xs text-muted-foreground">
              {message}
            </span>
          ) : null}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
        >
          <RefreshCwIcon className="size-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    </div>
  );
}

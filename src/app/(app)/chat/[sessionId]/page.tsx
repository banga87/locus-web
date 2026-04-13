// /chat/[sessionId] — minimal Client Component. Just enough to verify
// the streaming round-trip end-to-end. Task 4 replaces this with the
// real chat UI (sidebar, message bubbles, tool-call indicators, stop
// button styling).

'use client';

import { useState, use } from 'react';

import { useAgentChat } from '@/components/chat/use-agent-chat';

export default function ChatSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { messages, sendMessage, status, stop } = useAgentChat(sessionId);
  const [draft, setDraft] = useState('');

  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <div style={{ padding: '1rem', maxWidth: 720 }}>
      <h1>Chat — {sessionId}</h1>
      <p style={{ color: '#888' }}>
        Minimal harness for Task 1 verification. Real UI lands in Task 4.
      </p>

      <div style={{ marginTop: '1rem' }}>
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: '0.75rem' }}>
            <strong>{m.role}:</strong>{' '}
            {m.parts.map((p, i) => {
              if (p.type === 'text') return <span key={i}>{p.text}</span>;
              if (p.type.startsWith('tool-')) {
                return (
                  <em key={i} style={{ color: '#888' }}>
                    [{p.type}]
                  </em>
                );
              }
              return null;
            })}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          sendMessage({ text: draft });
          setDraft('');
        }}
        style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask the brain a question…"
          disabled={isStreaming}
          style={{ flex: 1, padding: '0.5rem' }}
        />
        {isStreaming ? (
          <button type="button" onClick={() => stop()}>
            Stop
          </button>
        ) : (
          <button type="submit">Send</button>
        )}
      </form>
    </div>
  );
}

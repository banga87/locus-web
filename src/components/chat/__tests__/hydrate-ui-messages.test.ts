// Hydration-from-persistence tests for the SSR path. We feed in
// fixtures shaped like rows from `session_turns` (raw UIMessage on the
// user side, model-shaped ResponseMessages on the assistant side) and
// assert that the output is a flat ordered UIMessage[] suitable for
// `useChat`'s in-memory store.

import { describe, expect, it } from 'vitest';

import { hydrateUIMessages } from '@/lib/sessions/hydrate-ui-messages';

describe('hydrateUIMessages', () => {
  it('returns [] for no turns', () => {
    expect(hydrateUIMessages([])).toEqual([]);
  });

  it('hydrates a simple text turn into [user, assistant]', () => {
    const result = hydrateUIMessages([
      {
        turnNumber: 1,
        userMessage: {
          id: 'u-original',
          role: 'user',
          parts: [{ type: 'text', text: 'Hi' }],
        },
        assistantMessages: [
          { role: 'assistant', content: 'Hello back' },
        ],
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'u-original',
      role: 'user',
      parts: [{ type: 'text', text: 'Hi' }],
    });
    expect(result[1]).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello back' }],
    });
  });

  it('attaches tool results from a following ToolModelMessage to the matching tool-call part', () => {
    const result = hydrateUIMessages([
      {
        turnNumber: 1,
        userMessage: {
          id: 'u',
          role: 'user',
          parts: [{ type: 'text', text: 'Look up brand voice' }],
        },
        assistantMessages: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Reading…' },
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'get_document',
                input: { path: 'brand/voice' },
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'call-1',
                output: { document: { content: '...' } },
              },
            ],
          },
          { role: 'assistant', content: 'Here is the summary.' },
        ],
      },
    ]);

    // user, assistant-with-tool-call, assistant-summary
    expect(result).toHaveLength(3);
    const assistantWithTool = result[1];
    expect(assistantWithTool.role).toBe('assistant');
    const toolPart = assistantWithTool.parts.find(
      (p) => p.type === 'dynamic-tool',
    ) as { state: string; output?: unknown } | undefined;
    expect(toolPart).toBeDefined();
    expect(toolPart!.state).toBe('output-available');
    expect(toolPart!.output).toMatchObject({
      document: { content: '...' },
    });
  });

  it('falls back to input-available when no tool-result is present', () => {
    const result = hydrateUIMessages([
      {
        turnNumber: 1,
        userMessage: {
          id: 'u',
          role: 'user',
          parts: [{ type: 'text', text: 'go' }],
        },
        assistantMessages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'orphan',
                toolName: 'search_documents',
                input: { query: 'voice' },
              },
            ],
          },
        ],
      },
    ]);

    const assistant = result[1];
    const toolPart = assistant.parts[0] as { state: string };
    expect(toolPart.state).toBe('input-available');
  });

  it('drops malformed user messages without throwing', () => {
    const result = hydrateUIMessages([
      {
        turnNumber: 1,
        userMessage: { not: 'a message' },
        assistantMessages: [
          { role: 'assistant', content: 'fallback' },
        ],
      },
    ]);
    // The user side is dropped; the assistant side is still emitted
    // because it can be rendered standalone (uncommon but possible
    // after a future schema change).
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
  });
});

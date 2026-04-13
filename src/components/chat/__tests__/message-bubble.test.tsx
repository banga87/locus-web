// MessageBubble rendering tests.
//
// We mock `MessageResponse` from `@/components/ai-elements/message`
// because Streamdown pulls in remark/rehype + a bunch of heavy plugins
// that don't add value to a unit test of OUR rendering logic. The mock
// renders the markdown source verbatim into a `<div>` so assertions
// against the bubble structure stay stable.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UIMessage } from 'ai';

vi.mock('@/components/ai-elements/message', () => ({
  MessageResponse: ({ children }: { children?: string }) => (
    <div data-testid="md-response">{children}</div>
  ),
}));

import { MessageBubble } from '@/components/chat/message-bubble';

describe('MessageBubble', () => {
  it('right-aligns user messages and renders text plain (no Markdown)', () => {
    const message: UIMessage = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello there' }],
    };
    const { container } = render(<MessageBubble message={message} />);
    const wrapper = container.querySelector('[data-role="user"]');
    expect(wrapper).not.toBeNull();
    // The flex parent should justify-end for user messages.
    expect(wrapper?.className).toContain('justify-end');
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    // No MessageResponse for user bubbles.
    expect(screen.queryByTestId('md-response')).toBeNull();
  });

  it('left-aligns assistant messages and renders text via MessageResponse', () => {
    const message: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: '**Bold** answer' }],
    };
    const { container } = render(<MessageBubble message={message} />);
    const wrapper = container.querySelector('[data-role="assistant"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain('justify-start');
    const md = screen.getByTestId('md-response');
    expect(md.textContent).toBe('**Bold** answer');
  });

  it('renders a tool-call indicator from a dynamic-tool part', () => {
    const message = {
      id: 'a2',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'get_document',
          toolCallId: 'tc-1',
          state: 'output-available',
          input: { path: 'brand/voice' },
          output: { document: { content: '...' } },
        },
      ],
    } as unknown as UIMessage;
    render(<MessageBubble message={message} />);
    expect(screen.getByText(/Used:/)).toBeInTheDocument();
    expect(screen.getByText('Brand Voice')).toBeInTheDocument();
  });

  it('treats LocusTool-shaped { error: true } output as an error indicator', () => {
    const message = {
      id: 'a3',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'get_document',
          toolCallId: 'tc-2',
          state: 'output-available',
          input: { path: 'unknown/path' },
          output: { error: true, message: 'document_not_found' },
        },
      ],
    } as unknown as UIMessage;
    render(<MessageBubble message={message} />);
    expect(screen.getByText(/Couldn't access Unknown Path/)).toBeInTheDocument();
  });

  it('skips parts it does not understand without crashing', () => {
    const message = {
      id: 'a4',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'After the step' },
      ],
    } as unknown as UIMessage;
    render(<MessageBubble message={message} />);
    expect(screen.getByTestId('md-response').textContent).toBe('After the step');
  });
});

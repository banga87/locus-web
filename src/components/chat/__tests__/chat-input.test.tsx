// ChatInput keyboard + button behaviour. Verifies the contract the
// chat-interface depends on: Enter submits, Shift+Enter doesn't, the
// send button toggles to a stop button while streaming, Escape clears.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ChatInput } from '@/components/chat/chat-input';

function setup(overrides: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const onStop = vi.fn();

  const props = {
    value: 'hello',
    onChange,
    onSubmit,
    onStop,
    isStreaming: false,
    ...overrides,
  };

  const utils = render(<ChatInput {...props} />);
  return { onChange, onSubmit, onStop, ...utils };
}

describe('ChatInput', () => {
  it('submits on plain Enter when there is text', () => {
    const { onSubmit } = setup();
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does NOT submit on Shift+Enter', () => {
    const { onSubmit } = setup();
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit when the value is whitespace only', () => {
    const { onSubmit } = setup({ value: '   ' });
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clears the draft on Escape', () => {
    const { onChange } = setup();
    const textarea = screen.getByLabelText('Chat message');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('renders a Stop button while streaming and calls onStop on click', () => {
    const { onStop, onSubmit } = setup({ isStreaming: true });
    const stopBtn = screen.getByLabelText('Stop generating');
    expect(stopBtn).toBeInTheDocument();
    fireEvent.click(stopBtn);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables the textarea while streaming', () => {
    setup({ isStreaming: true });
    expect(screen.getByLabelText('Chat message')).toBeDisabled();
  });

  it('disables the send button when the draft is empty', () => {
    setup({ value: '' });
    expect(screen.getByLabelText('Send message')).toBeDisabled();
  });

  it('renders the attachment paperclip button only when sessionId is provided', () => {
    // No sessionId — no paperclip. Phase 1 behaviour.
    const withoutSession = render(
      <ChatInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        isStreaming={false}
      />,
    );
    expect(
      withoutSession.queryByLabelText('Attach file'),
    ).not.toBeInTheDocument();
    withoutSession.unmount();

    // With sessionId — paperclip appears. Phase 1.5 additive wiring.
    render(
      <ChatInput
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        isStreaming={false}
        sessionId="00000000-0000-0000-0000-000000000000"
      />,
    );
    expect(screen.getByLabelText('Attach file')).toBeInTheDocument();
  });
});

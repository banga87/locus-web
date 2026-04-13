'use client';

// Chat composer. Multi-line textarea that auto-grows (Tailwind's
// `field-sizing-content` on the underlying primitive). Behaviour:
//
//   - Enter           → submit (unless empty)
//   - Shift+Enter     → newline (default textarea behaviour; we skip
//                       preventDefault on shift-enter)
//   - Cmd/Ctrl+Enter  → also submit (power-user shortcut)
//   - Escape          → clear the draft (optional polish)
//
// During streaming the textarea is disabled and the send button
// becomes a Stop button. The caller owns the `sendMessage` + `stop`
// wiring and the isStreaming flag — we don't touch `useChat` here.

import { useCallback, useRef, type KeyboardEvent } from 'react';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  disabled = false,
  placeholder = 'Message the agent…',
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trySubmit = useCallback(() => {
    if (!value.trim()) return;
    if (isStreaming) return;
    onSubmit();
  }, [value, isStreaming, onSubmit]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter') {
        // Shift+Enter → let the default newline insert happen.
        if (event.shiftKey) return;
        event.preventDefault();
        trySubmit();
        return;
      }
      if (event.key === 'Escape' && value) {
        event.preventDefault();
        onChange('');
      }
    },
    [trySubmit, value, onChange],
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        trySubmit();
      }}
      className="flex flex-col gap-2"
    >
      <div
        className={cn(
          'flex items-end gap-2 rounded-2xl border border-input bg-background px-3 py-2',
          'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30',
          'transition-colors',
        )}
      >
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isStreaming}
          rows={1}
          aria-label="Chat message"
          className={cn(
            // Strip the primitive's border/ring — the wrapper owns them
            // so the whole composer gets the focus ring.
            'min-h-0 max-h-52 resize-none border-0 bg-transparent px-0 py-1 shadow-none',
            'focus-visible:border-0 focus-visible:ring-0',
          )}
        />

        {isStreaming ? (
          <Button
            type="button"
            size="icon-sm"
            variant="secondary"
            aria-label="Stop generating"
            onClick={onStop}
          >
            <SquareIcon className="size-3.5" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            variant="default"
            aria-label="Send message"
            disabled={disabled || value.trim().length === 0}
          >
            <ArrowUpIcon className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
      <p className="px-1 text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for newline
      </p>
    </form>
  );
}

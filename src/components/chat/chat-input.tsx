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
//
// Phase 1.5: attachment support. When `sessionId` is passed, the
// composer renders a paperclip button + a chip list for attached
// files. Uploads go through `/api/attachments` server-side; the
// UserPromptSubmit hook reads `session_attachments` on the next turn,
// so we don't need to include attachment ids in the chat POST body —
// the chips are purely cosmetic client state.

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { SquareIcon } from 'lucide-react';

import { Icon } from '@/components/tatara';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  AttachmentInput,
  type AttachmentUploadItem,
} from './attachment-input';
import { AttachmentChip } from './attachment-chip';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  /**
   * When provided, enables attachment upload UI. Attachments are
   * persisted server-side against this session; removing a chip calls
   * DELETE /api/attachments/[id] to discard.
   */
  sessionId?: string;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  disabled = false,
  placeholder = 'Message the agent…',
  sessionId,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<AttachmentUploadItem[]>([]);

  const trySubmit = useCallback(() => {
    if (!value.trim()) return;
    if (isStreaming) return;
    // Block submit while any attachment is still uploading — the
    // UserPromptSubmit handler runs on the server against the
    // session's attachment rows, so a chat turn that predates the
    // upload completion would miss the attached content. Waiting for
    // the chip to flip to extracted/error keeps the contract simple.
    if (attachments.some((a) => a.status === 'uploading')) return;
    onSubmit();
  }, [value, isStreaming, attachments, onSubmit]);

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

  // Attachment list management. The chip list is cosmetic state —
  // uploads are tracked server-side against the session.
  const handleUploadStart = useCallback((item: AttachmentUploadItem) => {
    setAttachments((prev) => [...prev, item]);
  }, []);

  const handleUploadComplete = useCallback(
    (localId: string, update: Partial<AttachmentUploadItem>) => {
      setAttachments((prev) =>
        prev.map((a) => (a.localId === localId ? { ...a, ...update } : a)),
      );
    },
    [],
  );

  const handleUploadError = useCallback((localId: string, message: string) => {
    setAttachments((prev) =>
      prev.map((a) =>
        a.localId === localId
          ? { ...a, status: 'error', errorMessage: message }
          : a,
      ),
    );
  }, []);

  const handleRemoveAttachment = useCallback(
    async (item: AttachmentUploadItem) => {
      // Drop from local state immediately.
      setAttachments((prev) => prev.filter((a) => a.localId !== item.localId));

      // If the server ever saw this attachment, flip it to discarded.
      // Fire-and-forget: the UI has already removed the chip, and a
      // failed discard lingers as a stuck extracted row until the
      // nightly cron — no worse than before.
      if (item.serverId) {
        try {
          await fetch(`/api/attachments/${item.serverId}`, {
            method: 'DELETE',
            credentials: 'include',
          });
        } catch (err) {
          console.warn('[chat-input] discard request failed', err);
        }
      }
    },
    [],
  );

  const canAttach = Boolean(sessionId);
  const hasAttachments = attachments.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        trySubmit();
      }}
      className="flex flex-col gap-2"
    >
      {hasAttachments ? (
        <ul
          className="flex flex-wrap gap-1.5"
          role="list"
          aria-label="Attached files"
        >
          {attachments.map((a) => (
            <AttachmentChip
              key={a.localId}
              filename={a.filename}
              status={a.status}
              sizeBytes={a.sizeBytes}
              errorMessage={a.errorMessage}
              onRemove={() => handleRemoveAttachment(a)}
            />
          ))}
        </ul>
      ) : null}

      <div
        className={cn(
          // Tatara steering-input chrome: indigo-deep workbench surface
          'flex items-end gap-2 rounded-[var(--r-md)]',
          'border border-[rgba(242,234,216,0.18)]',
          'bg-[var(--indigo-deep)] px-3 py-2',
          'focus-within:border-[rgba(242,234,216,0.35)] focus-within:ring-3 focus-within:ring-[var(--ember-warm)]/30',
          'transition-colors',
        )}
      >
        {/* Left-side arrow cue — always shown as a visual anchor for the input */}
        <Icon
          name="ArrowRight"
          size={16}
          aria-hidden="true"
          className="mb-[5px] shrink-0 text-[var(--cream)] opacity-50"
        />

        {canAttach && sessionId ? (
          <AttachmentInput
            sessionId={sessionId}
            onUploadStart={handleUploadStart}
            onUploadComplete={handleUploadComplete}
            onUploadError={handleUploadError}
            disabled={disabled || isStreaming}
          />
        ) : null}

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
            // Cream text on indigo-deep ground
            'text-[var(--cream)] placeholder:text-[rgba(242,234,216,0.5)]',
          )}
        />

        {/* Inline ↵ hint before the action button */}
        <span
          className="mb-[5px] shrink-0 font-mono text-[11px] text-[rgba(242,234,216,0.5)]"
          aria-hidden="true"
        >
          ↵
        </span>

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
          // variant="accent" (brass) gives visible contrast against indigo-deep ground
          <Button
            type="submit"
            size="icon-sm"
            variant="accent"
            aria-label="Send message"
            disabled={
              disabled ||
              value.trim().length === 0 ||
              attachments.some((a) => a.status === 'uploading')
            }
          >
            <Icon name="ArrowUp" size={14} aria-hidden="true" />
          </Button>
        )}
      </div>
      {/* Screen-reader hint replaces the visible "Enter to send" paragraph */}
      <span className="sr-only">Enter to send, Shift+Enter for newline</span>
    </form>
  );
}

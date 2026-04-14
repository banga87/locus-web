'use client';

// AttachmentChip — a compact pill that sits above the chat composer
// once a file has been attached. Three visual states:
//
//   - 'uploading' (spinner)      — waiting on POST /api/attachments.
//   - 'extracted' (checkmark)    — ready to inject on the next turn.
//   - 'error' (warning)          — extractor failed; error text in tooltip.
//
// The chip is informational only — the attached content is read
// server-side from `session_attachments` on the next turn via the
// UserPromptSubmit handler. Removing a chip cancels the client-side
// tracking; it does NOT undo the upload. The separate Discard action
// (×) fires DELETE /api/attachments/[id] to transition the row to
// `discarded`.

import {
  CheckIcon,
  Loader2Icon,
  AlertTriangleIcon,
  XIcon,
  PaperclipIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type AttachmentChipStatus = 'uploading' | 'extracted' | 'error';

interface AttachmentChipProps {
  filename: string;
  status: AttachmentChipStatus;
  /** Optional byte size (displayed when present). */
  sizeBytes?: number;
  /** Error message surfaced in the title attribute when status='error'. */
  errorMessage?: string;
  /** Called when the user clicks the × button. Omit to hide the button. */
  onRemove?: () => void;
}

export function AttachmentChip({
  filename,
  status,
  sizeBytes,
  errorMessage,
  onRemove,
}: AttachmentChipProps) {
  const statusIcon = renderStatusIcon(status);
  const sizeLabel =
    typeof sizeBytes === 'number' ? `· ${formatSize(sizeBytes)}` : null;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
        'text-xs max-w-xs',
        // Colour cues track the status dot — avoid loud colour tokens
        // elsewhere in the chip so the state stays readable.
        status === 'error'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-border bg-muted text-foreground',
      )}
      role="listitem"
      data-testid="attachment-chip"
      data-status={status}
      title={status === 'error' ? errorMessage : undefined}
    >
      <PaperclipIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate font-medium">{filename}</span>
      {sizeLabel ? (
        <span className="text-muted-foreground">{sizeLabel}</span>
      ) : null}
      <span className="shrink-0" aria-label={`status: ${status}`}>
        {statusIcon}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${filename}`}
          className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        >
          <XIcon className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function renderStatusIcon(status: AttachmentChipStatus) {
  if (status === 'uploading') {
    return (
      <Loader2Icon
        className="size-3.5 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
    );
  }
  if (status === 'extracted') {
    return (
      <CheckIcon
        className="size-3.5 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
    );
  }
  return (
    <AlertTriangleIcon className="size-3.5 text-destructive" aria-hidden="true" />
  );
}

/** Format bytes as KB/MB with one decimal. Small helper so the chip
 *  doesn't drag in a general formatter. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

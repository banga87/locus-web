'use client';

// AttachmentInput — the paperclip + hidden file-input pair that lives
// inside the chat composer. Delegates to the /api/attachments POST
// endpoint; the parent owns the attached-chip list so it can render
// chips above the textarea.
//
// Contract:
//   - On file select, POSTs the file + sessionId as multipart/form-data.
//   - Calls `onUploadStart` with the locally-tracked item (temp id +
//     filename + uploading status) so the UI shows a chip immediately.
//   - Calls `onUploadComplete` on 2xx with the server-assigned id and
//     final status ('extracted' or 'uploaded' with extractionError).
//   - Calls `onUploadError` on any network/http failure; the parent
//     flips the chip to error state.
//
// File picker accepts the same mime whitelist the server enforces —
// the UI pre-filters so users don't waste a round trip. The server's
// whitelist is still authoritative (a user could override the picker's
// filter via drag-and-drop in other browsers).

import { useRef, type ChangeEvent } from 'react';
import { PaperclipIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SUPPORTED_MIMES } from '@/lib/ingestion/types';

/**
 * Shape tracked by the parent's attachment list. The `localId` is a
 * client-side-only discriminator used to correlate the optimistic
 * chip with the server response (server assigns the real id).
 */
export interface AttachmentUploadItem {
  localId: string;
  serverId?: string;
  filename: string;
  sizeBytes?: number;
  status: 'uploading' | 'extracted' | 'error';
  errorMessage?: string;
}

interface AttachmentInputProps {
  sessionId: string;
  onUploadStart: (item: AttachmentUploadItem) => void;
  onUploadComplete: (
    localId: string,
    update: Partial<AttachmentUploadItem>,
  ) => void;
  onUploadError: (localId: string, message: string) => void;
  disabled?: boolean;
}

// Accept list for the <input type="file"> picker. Using the SUPPORTED_
// MIMES constant keeps the UI + server in lockstep — adding a new mime
// propagates automatically.
const ACCEPT_ATTRIBUTE = SUPPORTED_MIMES.join(',');

export function AttachmentInput({
  sessionId,
  onUploadStart,
  onUploadComplete,
  onUploadError,
  disabled,
}: AttachmentInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePick = () => {
    fileRef.current?.click();
  };

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Process each selected file in parallel — the server handles
    // concurrent uploads independently (each gets its own row).
    await Promise.all(
      Array.from(files).map((file) => uploadFile(file, sessionId, {
        onUploadStart,
        onUploadComplete,
        onUploadError,
      })),
    );

    // Reset the input so selecting the same file again re-triggers
    // onChange. Without this, picking the same file twice in a row
    // does nothing (no change event).
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="hidden"
        onChange={handleChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Attach file"
        onClick={handlePick}
        disabled={disabled}
        data-testid="attachment-input-button"
      >
        <PaperclipIcon className="size-4" aria-hidden="true" />
      </Button>
    </>
  );
}

// ---- Upload orchestration -----------------------------------------------

interface UploadCallbacks {
  onUploadStart: (item: AttachmentUploadItem) => void;
  onUploadComplete: (
    localId: string,
    update: Partial<AttachmentUploadItem>,
  ) => void;
  onUploadError: (localId: string, message: string) => void;
}

async function uploadFile(
  file: File,
  sessionId: string,
  cb: UploadCallbacks,
): Promise<void> {
  // crypto.randomUUID() is available in every browser we target (2021+).
  // Falling back to Date.now + Math.random for environments without
  // it — harmless since the local id never leaves the browser.
  const localId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  cb.onUploadStart({
    localId,
    filename: file.name,
    sizeBytes: file.size,
    status: 'uploading',
  });

  const form = new FormData();
  form.set('file', file);
  form.set('sessionId', sessionId);

  try {
    const response = await fetch('/api/attachments', {
      method: 'POST',
      body: form,
      credentials: 'include',
    });

    if (!response.ok) {
      const message = await readErrorMessage(response);
      cb.onUploadError(localId, message);
      return;
    }

    const payload = (await response.json()) as {
      data?: {
        id: string;
        status: 'uploaded' | 'extracted';
        extractionError?: string;
      };
    };
    const data = payload.data;
    if (!data) {
      cb.onUploadError(localId, 'Malformed server response.');
      return;
    }

    if (data.status === 'extracted') {
      cb.onUploadComplete(localId, {
        serverId: data.id,
        status: 'extracted',
      });
    } else {
      // uploaded-but-not-extracted = extraction failed. Surface the
      // error so the user knows why the chip shows a warning.
      cb.onUploadComplete(localId, {
        serverId: data.id,
        status: 'error',
        errorMessage: data.extractionError ?? 'Extraction failed.',
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cb.onUploadError(localId, message);
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };
    if (payload?.error?.message) return payload.error.message;
  } catch {
    /* fall through */
  }
  return `${response.status} ${response.statusText || 'Request failed'}`;
}

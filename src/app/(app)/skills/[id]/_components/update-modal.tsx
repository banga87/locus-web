'use client';

// UpdateModal — two-stage update flow for installed skills.
//
// On open: POST /api/skills/[id]/update/preview.
//   - up_to_date=true  → shows "Already up to date" with current SHA.
//   - up_to_date=false → renders SkillPreviewView with the new content.
//
// Confirm → POST /api/skills/[id]/update → router.refresh().
//
// Mirrors the AbortController and error-mapping patterns from install-modal.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SkillPreviewView } from '@/app/(app)/skills/_components/skill-preview-view';
import type { SkillPreview } from '@/lib/skills/github-import';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpdateModalProps {
  skillId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ModalState =
  | { stage: 'idle' }
  | { stage: 'loading' }
  | { stage: 'up_to_date'; sha: string }
  | { stage: 'update_available'; preview: SkillPreview; latestSha: string; currentSha: string }
  | { stage: 'updating'; preview: SkillPreview; latestSha: string }
  | { stage: 'error'; message: string };

// ─── Error mapping ────────────────────────────────────────────────────────────

function mapErrorCode(code: string, message: string): string {
  switch (code) {
    case 'not_found':
      return "The skill couldn't be found.";
    case 'not_an_install':
      return 'This skill is not installed from GitHub — it cannot be updated.';
    case 'not_a_skill':
      return "The repository no longer contains a valid SKILL.md.";
    case 'empty_description':
      return "The upstream skill's description field is empty.";
    case 'sha_not_found':
      return 'The commit you reviewed is gone. Re-open to refresh.';
    case 'rate_limited':
      return message;
    case 'upstream_error':
      return 'GitHub is unavailable. Try again in a moment.';
    default:
      return message || 'Something went wrong. Please try again.';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UpdateModal({ skillId, open, onOpenChange }: UpdateModalProps) {
  const router = useRouter();
  const [state, setState] = useState<ModalState>({ stage: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      abortRef.current?.abort();
      setState({ stage: 'idle' });
    }
    onOpenChange(next);
  }

  // Load the preview automatically when the dialog opens.
  async function loadPreview() {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setState({ stage: 'loading' });

    try {
      const res = await fetch(`/api/skills/${skillId}/update/preview`, {
        method: 'POST',
        signal: abortRef.current.signal,
      });
      const body: {
        success: boolean;
        data?: {
          up_to_date: boolean;
          current_sha?: string;
          latest_sha?: string;
          preview?: SkillPreview;
        };
        error?: { code: string; message: string };
      } = await res.json();

      if (!body.success || !body.data) {
        const code = body.error?.code ?? 'unknown';
        const msg = body.error?.message ?? 'Unknown error';
        setState({ stage: 'error', message: mapErrorCode(code, msg) });
        return;
      }

      const data = body.data;

      if (data.up_to_date) {
        setState({ stage: 'up_to_date', sha: data.current_sha ?? '' });
      } else {
        setState({
          stage: 'update_available',
          preview: data.preview!,
          latestSha: data.latest_sha ?? '',
          currentSha: data.current_sha ?? '',
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setState({ stage: 'error', message: 'Network error. Check your connection and try again.' });
    }
  }

  async function handleConfirmUpdate() {
    if (state.stage !== 'update_available') return;
    const { preview, latestSha } = state;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState({ stage: 'updating', preview, latestSha });

    try {
      const res = await fetch(`/api/skills/${skillId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_sha: latestSha }),
        signal: abortRef.current.signal,
      });
      const body: { success: boolean; error?: { code: string; message: string } } =
        await res.json();

      if (!body.success) {
        const code = body.error?.code ?? 'unknown';
        const msg = body.error?.message ?? 'Unknown error';
        setState({ stage: 'error', message: mapErrorCode(code, msg) });
        return;
      }

      handleOpenChange(false);
      router.refresh();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setState({ stage: 'error', message: 'Network error. Check your connection and try again.' });
    }
  }

  const isLoading = state.stage === 'loading' || state.stage === 'updating';

  // origin stub for SkillPreviewView — we don't have a URL here so use empty
  // strings; the SHA is what matters.
  const previewOrigin =
    state.stage === 'update_available' || state.stage === 'updating'
      ? {
          owner: '',
          repo: '',
          skillName: null,
          sha: state.latestSha,
        }
      : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && state.stage === 'idle') loadPreview();
        handleOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check for updates</DialogTitle>
          <DialogDescription>
            Compare the installed skill against the latest upstream version.
          </DialogDescription>
        </DialogHeader>

        {/* Loading */}
        {state.stage === 'loading' && (
          <p className="text-sm text-muted-foreground py-4">Checking upstream…</p>
        )}

        {/* Up to date */}
        {state.stage === 'up_to_date' && (
          <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
            <p className="font-medium">Already up to date.</p>
            <p className="mt-1 text-xs text-muted-foreground font-mono">{state.sha.slice(0, 7)}</p>
          </div>
        )}

        {/* Update available */}
        {(state.stage === 'update_available' || state.stage === 'updating') && previewOrigin && (
          <ScrollArea className="max-h-[60vh]">
            <div className="pr-1">
              <SkillPreviewView
                preview={state.preview}
                origin={previewOrigin}
              />
            </div>
          </ScrollArea>
        )}

        {/* Error */}
        {state.stage === 'error' && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.message}
          </div>
        )}

        <DialogFooter>
          {state.stage === 'update_available' ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button onClick={handleConfirmUpdate} disabled={isLoading}>
                Confirm Update
              </Button>
            </>
          ) : state.stage === 'updating' ? (
            <Button disabled>Updating…</Button>
          ) : (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

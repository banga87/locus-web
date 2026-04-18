'use client';

// InstallModal — two-stage install flow.
//
// Stage 1 (idle / loading-preview): URL input with live format hint → calls
//   POST /api/skills/import/preview → advances to stage "preview-ready".
//
// Stage 2 (preview-ready / installing): Renders SkillPreviewView → user clicks
//   "Install" → calls POST /api/skills/import with confirmed_sha → on 201
//   navigates to /skills/[id].
//
// Error state surfaces actionable messages mapped from error codes.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SkillPreviewView } from './skill-preview-view';
import type { SkillPreview } from '@/lib/skills/github-import';

// ─── State machine ──────────────────────────────────────────────────────────

type ModalState =
  | { stage: 'idle' }
  | { stage: 'loading-preview' }
  | { stage: 'preview-ready'; preview: SkillPreview; url: string }
  | { stage: 'installing'; preview: SkillPreview; url: string }
  | { stage: 'error'; message: string };

// ─── Error code → user-friendly message ─────────────────────────────────────

function mapErrorCode(code: string, message: string): string {
  switch (code) {
    case 'invalid_url':
      return "That URL isn't a skill URL we recognise.";
    case 'not_a_skill':
      return "The repository doesn't contain a valid SKILL.md at that path.";
    case 'not_found':
      return "We couldn't find that skill on GitHub.";
    case 'empty_description':
      return "The skill's description field is empty. It can't be installed.";
    case 'rate_limited':
      // message already contains reset info from the server
      return message;
    case 'upstream_error':
      return 'Upstream GitHub error. Try again in a moment.';
    case 'sha_not_found':
      return 'The commit you reviewed is gone. Re-preview the skill.';
    case 'slug_taken':
      return 'A skill with that name already exists in this workspace.';
    default:
      return message || 'Something went wrong. Please try again.';
  }
}

// ─── Live URL hint ───────────────────────────────────────────────────────────

function urlHint(url: string): string | null {
  if (!url) return null;
  if (/^https?:\/\/skills\.sh\//i.test(url)) return 'skills.sh skill';
  if (/^https?:\/\/github\.com\//i.test(url)) {
    const m = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)/i);
    return m ? `github.com/${m[1]}` : 'github.com URL';
  }
  return null;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

interface ApiError {
  code: string;
  message: string;
}

interface PreviewResponseBody {
  success: boolean;
  data?: SkillPreview;
  error?: ApiError;
}

interface InstallResponseBody {
  success: boolean;
  data?: { skill_id: string };
  error?: ApiError;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface InstallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InstallModal({ open, onOpenChange }: InstallModalProps) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ModalState>({ stage: 'idle' });

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Reset on close
      setUrl('');
      setState({ stage: 'idle' });
    }
    onOpenChange(next);
  }

  async function handlePreview() {
    const trimmed = url.trim();
    if (!trimmed) return;

    setState({ stage: 'loading-preview' });

    try {
      const res = await fetch('/api/skills/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      const body: PreviewResponseBody = await res.json();

      if (!body.success || !body.data) {
        const code = body.error?.code ?? 'unknown';
        const msg = body.error?.message ?? 'Unknown error';
        setState({ stage: 'error', message: mapErrorCode(code, msg) });
        return;
      }

      setState({ stage: 'preview-ready', preview: body.data, url: trimmed });
    } catch {
      setState({ stage: 'error', message: 'Network error. Check your connection and try again.' });
    }
  }

  async function handleInstall() {
    if (state.stage !== 'preview-ready') return;
    const { preview, url: confirmedUrl } = state;

    setState({ stage: 'installing', preview, url: confirmedUrl });

    try {
      const res = await fetch('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: confirmedUrl, confirmed_sha: preview.sha }),
      });

      const body: InstallResponseBody = await res.json();

      if (!body.success || !body.data) {
        const code = body.error?.code ?? 'unknown';
        const msg = body.error?.message ?? 'Unknown error';
        setState({ stage: 'error', message: mapErrorCode(code, msg) });
        return;
      }

      handleOpenChange(false);
      router.push(`/skills/${body.data.skill_id}`);
    } catch {
      setState({ stage: 'error', message: 'Network error. Check your connection and try again.' });
    }
  }

  function handleBack() {
    setState({ stage: 'idle' });
  }

  const isLoading = state.stage === 'loading-preview' || state.stage === 'installing';
  const isPreviewReady = state.stage === 'preview-ready';
  const isInstalling = state.stage === 'installing';
  const hint = urlHint(url);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isPreviewReady || isInstalling ? 'Review skill' : 'Install skill from GitHub'}
          </DialogTitle>
          <DialogDescription>
            {isPreviewReady || isInstalling
              ? 'Review the skill contents before installing into your workspace.'
              : 'Paste a GitHub or skills.sh URL to preview the skill before installing.'}
          </DialogDescription>
        </DialogHeader>

        {/* Stage 1: URL input */}
        {(state.stage === 'idle' ||
          state.stage === 'loading-preview' ||
          state.stage === 'error') && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-url">Skill URL</Label>
              <Input
                id="skill-url"
                type="url"
                placeholder="https://github.com/owner/repo or https://skills.sh/owner/skills/name"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (state.stage === 'error') setState({ stage: 'idle' });
                }}
                disabled={isLoading}
                autoFocus
              />
              {hint && (
                <p className="text-xs text-muted-foreground">Detected: {hint}</p>
              )}
            </div>

            {state.stage === 'error' && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {state.message}
              </div>
            )}
          </div>
        )}

        {/* Stage 2: Preview */}
        {(isPreviewReady || isInstalling) && (
          <ScrollArea className="max-h-[60vh]">
            <div className="pr-1">
              <SkillPreviewView
                preview={
                  state.stage === 'preview-ready' || state.stage === 'installing'
                    ? state.preview
                    : (null as never)
                }
                origin={{
                  owner: extractOwner(
                    state.stage === 'preview-ready' || state.stage === 'installing'
                      ? state.url
                      : '',
                  ),
                  repo: extractRepo(
                    state.stage === 'preview-ready' || state.stage === 'installing'
                      ? state.url
                      : '',
                  ),
                  skillName: extractSkillName(
                    state.stage === 'preview-ready' || state.stage === 'installing'
                      ? state.url
                      : '',
                  ),
                  sha: (state.stage === 'preview-ready' || state.stage === 'installing')
                    ? state.preview.sha
                    : '',
                }}
              />
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          {(isPreviewReady || isInstalling) ? (
            <>
              <Button variant="outline" onClick={handleBack} disabled={isInstalling}>
                Back
              </Button>
              <Button onClick={handleInstall} disabled={isInstalling}>
                {isInstalling ? 'Installing…' : 'Install'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button onClick={handlePreview} disabled={!url.trim() || isLoading}>
                {state.stage === 'loading-preview' ? 'Previewing…' : 'Preview'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Client-side URL parsing helpers (lightweight — no server logic) ─────────

function extractOwner(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'skills.sh') {
      const m = u.pathname.match(/^\/([^/]+)\//);
      return m?.[1] ?? '';
    }
    if (u.hostname === 'github.com') {
      const m = u.pathname.match(/^\/([^/]+)\//);
      return m?.[1] ?? '';
    }
  } catch {
    // invalid URL
  }
  return '';
}

function extractRepo(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'skills.sh') {
      return 'skills';
    }
    if (u.hostname === 'github.com') {
      const m = u.pathname.match(/^\/[^/]+\/([^/]+)/);
      return m?.[1] ?? '';
    }
  } catch {
    // invalid URL
  }
  return '';
}

function extractSkillName(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'skills.sh') {
      const m = u.pathname.match(/^\/[^/]+\/skills\/([^/]+)\/?$/);
      return m?.[1] ?? null;
    }
  } catch {
    // invalid URL
  }
  return null;
}

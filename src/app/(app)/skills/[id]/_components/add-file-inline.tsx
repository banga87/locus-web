'use client';

// AddFileInline — inline form rendered at the bottom of the file tree for
// authored/forked skills. Allows adding a new resource file to the skill.
//
// Props:
//   skillId  — root skill document id
//   onSaved  — called after a successful POST so the parent can refresh
//   onCancel — called when the user dismisses the form

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TiptapEditor } from '@/components/editor/tiptap-editor';

interface AddFileInlineProps {
  skillId: string;
  onSaved?: () => void;
  onCancel?: () => void;
}

export function AddFileInline({ skillId, onSaved, onCancel }: AddFileInlineProps) {
  const router = useRouter();

  const [relativePath, setRelativePath] = useState('');
  // TiptapEditor emits HTML; we store it and send as content.
  // Known tradeoff: markdown fidelity is lossy on round-trip (see file-viewer.tsx).
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  function handleCancel() {
    abortRef.current?.abort();
    onCancel?.();
  }

  async function handleSave() {
    setSaveError(null);

    // Validate relative_path client-side before fetch.
    const trimmedPath = relativePath.trim();
    if (!trimmedPath) {
      setSaveError('relative_path is required.');
      return;
    }
    if (trimmedPath.startsWith('/')) {
      setSaveError('Path must not start with /.');
      return;
    }
    if (trimmedPath.split('/').includes('..')) {
      setSaveError('Path must not contain .. segments.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${skillId}/resources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ relative_path: trimmedPath, content }),
        signal: controller.signal,
      });

      if (res.ok) {
        router.refresh();
        onSaved?.();
      } else {
        const json = (await res.json()) as { error?: { message?: string } };
        setSaveError(json?.error?.message ?? 'Failed to save file.');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setSaveError('An unexpected error occurred.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded border border-border bg-background px-3 py-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="add-file-path">
          relative_path
        </label>
        <Input
          id="add-file-path"
          value={relativePath}
          onChange={(e) => setRelativePath(e.target.value)}
          placeholder="templates/short.md"
          className="h-7 font-mono text-xs"
          disabled={saving}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">body</span>
        {/* Tiptap receives empty string; emits HTML on update.
            Known tradeoff: markdown↔HTML fidelity is lossy. See file-viewer.tsx. */}
        <div className="rounded border border-border">
          <TiptapEditor
            initialContent=""
            placeholder="Start writing…"
            onUpdate={(html) => setContent(html)}
          />
        </div>
      </div>

      {saveError && (
        <p className="text-xs text-destructive">{saveError}</p>
      )}

      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

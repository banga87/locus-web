'use client';

// FileViewer — right-pane content viewer for the skill detail page.
//
// Read-only for installed skills: renders markdown via DocumentRenderer.
// For authored/forked skills an "Edit" toggle swaps to TiptapEditor.
//
// Known tradeoff: Tiptap operates on HTML internally. We pass raw markdown as
// initialContent (Tiptap treats it as plain text) and save whatever getHTML()
// emits. Markdown↔HTML fidelity is lossy on round-trip — a proper pipeline
// (markdown-it → ProseMirror, prosemirror-to-markdown) is deferred post-MVP.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PencilIcon, XIcon } from 'lucide-react';
import { marked } from 'marked';

import { Button } from '@/components/ui/button';
import { TiptapEditor } from '@/components/editor/tiptap-editor';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileViewerProps {
  /** Raw markdown content of the selected file. */
  content: string;
  /** Filename / title for display. */
  filename: string;
  /** Allow edit toggle (authored or forked skill). */
  canEdit: boolean;
  /** Root skill document id — used to build the PATCH URL. */
  skillId: string;
  /**
   * The relative path that identifies this file in the API:
   *   'SKILL.md'           → PATCH updates root body
   *   'references/foo.md'  → PATCH updates that child resource
   */
  relativePath: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FileViewer({
  content,
  filename,
  canEdit,
  skillId,
  relativePath,
}: FileViewerProps) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  // Tiptap receives raw markdown as a string; it treats it as plain text.
  // See the known-tradeoff comment at the top of this file.
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  function handleEdit() {
    setDraft(content);
    setSaveError(null);
    setEditing(true);
  }

  function handleCancel() {
    abortRef.current?.abort();
    setEditing(false);
    setSaveError(null);
  }

  async function handleSave() {
    setSaveError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    setSaving(true);
    try {
      const encodedPath = relativePath
        .split('/')
        .map(encodeURIComponent)
        .join('/');

      const res = await fetch(`/api/skills/${skillId}/resources/${encodedPath}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: draft }),
        signal: controller.signal,
      });

      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        const json = (await res.json()) as { error?: { message?: string } };
        setSaveError(json?.error?.message ?? 'Failed to save.');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setSaveError('An unexpected error occurred.');
      }
    } finally {
      setSaving(false);
    }
  }

  const html = marked.parse(content, { async: false }) as string;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0">
        <span className="text-xs font-mono text-muted-foreground">{filename}</span>
        {canEdit && (
          <div className="flex items-center gap-1.5">
            {editing ? (
              <>
                {saveError && (
                  <span className="text-xs text-destructive mr-2">{saveError}</span>
                )}
                <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                  <XIcon className="mr-1.5 size-3.5" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={handleEdit}>
                <PencilIcon className="mr-1.5 size-3.5" />
                Edit
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {editing ? (
          <div className="px-4 py-4">
            <TiptapEditor
              initialContent={draft}
              placeholder="Start writing…"
              onUpdate={(html) => setDraft(html)}
            />
          </div>
        ) : (
          <div className="px-6 py-6">
            <article
              className="prose prose-zinc max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

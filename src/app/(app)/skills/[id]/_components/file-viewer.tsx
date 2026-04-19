'use client';

// FileViewer — right-pane content viewer for the skill detail page.
//
// Read-only for installed skills: renders markdown via DocumentRenderer.
// For authored/forked skills an "Edit" toggle swaps to TiptapEditor.
//
// Save is STUBBED in Task 24 — the PATCH route lands in Task 25.
// Clicking Save shows an alert and logs a TODO comment.

import { useState } from 'react';
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
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FileViewer({ content, filename, canEdit }: FileViewerProps) {
  const [editing, setEditing] = useState(false);
  // Tiptap receives raw markdown as a string; Save is stubbed so fidelity
  // doesn't matter here — Task 25 will add proper markdown↔HTML conversion.
  const [draft, setDraft] = useState(content);

  function handleEdit() {
    setDraft(content);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
  }

  function handleSave() {
    // TODO(Task 25): wire up PATCH /api/skills/[id]/resources/[path]
    // Coming in next task — Save is stubbed here.
    console.log('[FileViewer] stub: save not yet wired', { filename, draft });
    alert('Save will be implemented in the next task.');
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
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  <XIcon className="mr-1.5 size-3.5" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave}>
                  Save
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

'use client';

// WorkflowDetailTabs — tab switcher for the workflow detail page.
//
// Tab state is driven by the `?tab=` URL param via router.push so the
// active tab is bookmarkable and survives a refresh.
//
// Definition tab: inline Tiptap editor + auto-save + FrontmatterPanel.
// Runs tab:       RunHistoryTable.
//
// We do NOT use <DocumentEditor> here because that component renders its own
// .topbar — nesting a second topbar inside a tab panel would break the layout.
// Instead we use the useFrontmatterEditor hook (same pattern as DocumentEditor)
// and render only the editor content area.

import {
  useCallback,
  useState,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { CheckIcon, LoaderIcon, XCircleIcon } from 'lucide-react';

import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { FrontmatterPanel } from '@/components/frontmatter/frontmatter-panel';
import {
  useFrontmatterEditor,
  type SaveState,
} from '@/components/frontmatter/use-frontmatter-editor';
import { RunHistoryTable } from './run-history-table';

type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'queued';

interface RunRow {
  id: string;
  status: RunStatus;
  startedAt: Date;
  completedAt: Date | null;
  summary: string | null;
  totalCostUsd: string | null;
}

interface DocumentData {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'active' | 'archived';
  confidenceLevel: 'high' | 'medium' | 'low';
  ownerId: string | null;
}

interface Props {
  document: DocumentData;
  runs: RunRow[];
  workflowSlug: string;
  docType: string | null;
  canEdit: boolean;
  activeTab: 'definition' | 'runs';
}

function SaveIndicator({ state }: { state: SaveState }) {
  switch (state) {
    case 'idle':
      return null;
    case 'pending':
      return <span className="text-xs text-muted-foreground">Editing…</span>;
    case 'saving':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <LoaderIcon className="size-3 animate-spin" />
          Saving…
        </span>
      );
    case 'saved':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CheckIcon className="size-3" />
          Saved
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <XCircleIcon className="size-3" />
          Failed to save
        </span>
      );
  }
}

function DefinitionEditor({
  document,
  docType,
  canEdit,
}: {
  document: DocumentData;
  docType: string | null;
  canEdit: boolean;
}) {
  const [title, setTitle] = useState(document.title);

  const editor = useFrontmatterEditor({
    documentId: document.id,
    initialContent: document.content,
    docType,
    canEdit,
  });
  const { onFieldPatch } = editor;

  const onTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTitle(e.target.value);
      onFieldPatch({ title: e.target.value });
    },
    [onFieldPatch],
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 rounded-lg border border-border bg-background p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            {canEdit ? (
              <input
                type="text"
                value={title}
                onChange={onTitleChange}
                placeholder="Untitled"
                className="flex-1 border-0 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
              />
            ) : (
              <h1 className="flex-1 text-2xl font-semibold tracking-tight">{title}</h1>
            )}
            <SaveIndicator state={editor.saveState} />
          </div>

          {canEdit ? (
            <TiptapEditor
              initialContent={editor.initialHtml}
              placeholder="Describe what this workflow should do…"
              onUpdate={editor.onBodyHtmlChange}
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm text-ink">{document.content}</pre>
          )}
        </div>

        {editor.panelState.schema ? (
          <FrontmatterPanel
            schema={editor.panelState.schema}
            value={editor.panelState.value}
            rawYaml={editor.panelState.rawYaml}
            mode={editor.panelState.mode}
            canEdit={canEdit}
            onFieldsChange={editor.onPanelChange}
            onRawChange={editor.onRawChange}
            onModeChange={editor.onModeChange}
            error={editor.panelState.error}
          />
        ) : null}
      </div>
    </div>
  );
}

export function WorkflowDetailTabs({
  document,
  runs,
  workflowSlug,
  docType,
  canEdit,
  activeTab,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  function selectTab(tab: 'definition' | 'runs') {
    const url = tab === 'definition' ? pathname : `${pathname}?tab=runs`;
    router.push(url);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-border px-6">
        <button
          type="button"
          onClick={() => selectTab('definition')}
          className={[
            'mr-4 border-b-2 py-3 text-sm font-medium transition-colors',
            activeTab === 'definition'
              ? 'border-ink text-ink'
              : 'border-transparent text-muted-foreground hover:text-ink',
          ].join(' ')}
        >
          Definition
        </button>
        <button
          type="button"
          onClick={() => selectTab('runs')}
          className={[
            'mr-4 border-b-2 py-3 text-sm font-medium transition-colors',
            activeTab === 'runs'
              ? 'border-ink text-ink'
              : 'border-transparent text-muted-foreground hover:text-ink',
          ].join(' ')}
        >
          Runs
          {runs.length > 0 && (
            <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
              {runs.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab panels */}
      {activeTab === 'definition' ? (
        <div className="flex-1 overflow-auto">
          <DefinitionEditor document={document} docType={docType} canEdit={canEdit} />
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-6 py-6">
          <RunHistoryTable runs={runs} workflowSlug={workflowSlug} />
        </div>
      )}
    </div>
  );
}

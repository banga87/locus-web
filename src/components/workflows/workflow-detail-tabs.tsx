'use client';

// WorkflowDetailTabs — tab switcher for the workflow detail page.
//
// Tab state is driven by the `?tab=` URL param via router.push so the
// active tab is bookmarkable and survives a refresh.
//
// Definition tab: inline Tiptap editor + auto-save + WorkflowFrontmatterFields.
// Runs tab:       RunHistoryTable.
//
// We do NOT use <DocumentEditor> here because that component renders its own
// .topbar — nesting a second topbar inside a tab panel would break the layout.
// Instead we inline the save logic (same debounce pattern DocumentEditor uses)
// and render only the editor content area.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { CheckIcon, LoaderIcon, XCircleIcon } from 'lucide-react';

import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { RunHistoryTable } from './run-history-table';
import { WorkflowFrontmatterFields } from './workflow-frontmatter-fields';
import type { WorkflowFrontmatterValue } from './workflow-frontmatter-fields';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

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
  frontmatter: WorkflowFrontmatterValue;
  canEdit: boolean;
  activeTab: 'definition' | 'runs';
}

const DEBOUNCE_MS = 500;

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

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
  frontmatter,
  canEdit,
}: {
  document: DocumentData;
  frontmatter: WorkflowFrontmatterValue;
  canEdit: boolean;
}) {
  const initialHtml = useMemo(
    () => marked.parse(document.content, { async: false }) as string,
    [document.content],
  );

  const [title, setTitle] = useState(document.title);
  const latestHtml = useRef<string>(initialHtml);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    timer.current = null;
    if (Object.keys(patch).length === 0) return;

    setSaveState('saving');
    try {
      const res = await fetch(`/api/brain/documents/${document.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState('saved');
    } catch (err) {
      console.error('[WorkflowDetailTabs] save failed', err);
      setSaveState('error');
    }
  }, [document.id]);

  const schedule = useCallback(
    (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      setSaveState('pending');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
    },
    [flush],
  );

  const onHtmlUpdate = useCallback(
    (html: string) => {
      latestHtml.current = html;
      const md = turndown.turndown(html);
      schedule({ content: md });
    },
    [schedule],
  );

  const onTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTitle(e.target.value);
      schedule({ title: e.target.value });
    },
    [schedule],
  );

  // Flush on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void flush();
      }
    };
  }, [flush]);

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
              <h1 className="flex-1 text-2xl font-semibold tracking-tight">
                {title}
              </h1>
            )}
            <SaveIndicator state={saveState} />
          </div>

          {canEdit ? (
            <TiptapEditor
              initialContent={initialHtml}
              placeholder="Describe what this workflow should do…"
              onUpdate={onHtmlUpdate}
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm text-ink">
              {document.content}
            </pre>
          )}
        </div>

        <WorkflowFrontmatterFields frontmatter={frontmatter} />
      </div>
    </div>
  );
}

export function WorkflowDetailTabs({
  document,
  runs,
  workflowSlug,
  frontmatter,
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
          <DefinitionEditor
            document={document}
            frontmatter={frontmatter}
            canEdit={canEdit}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-6 py-6">
          <RunHistoryTable runs={runs} workflowSlug={workflowSlug} />
        </div>
      )}
    </div>
  );
}

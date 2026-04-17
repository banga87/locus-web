'use client';

// Brain document editor. Now delegates all save/debounce/markdown-split
// plumbing to useFrontmatterEditor; this file is the layout + wiring.

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckIcon, LoaderIcon, XIcon, XCircleIcon } from 'lucide-react';

import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import {
  FrontmatterSidebar,
  type FrontmatterValue,
} from './frontmatter-sidebar';
import { FrontmatterPanel } from '@/components/frontmatter/frontmatter-panel';
import {
  useFrontmatterEditor,
  type SaveState,
} from '@/components/frontmatter/use-frontmatter-editor';

interface DocumentData {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'active' | 'archived';
  confidenceLevel: 'high' | 'medium' | 'low';
  ownerId: string | null;
  /** Denormalised documents.type — drives schema selection. Pass null for plain docs. */
  type: string | null;
}

interface UserOption {
  id: string;
  label: string;
}

interface Props {
  document: DocumentData;
  owners: UserOption[];
}

export function DocumentEditor({ document, owners }: Props) {
  const router = useRouter();

  const [frontmatter, setFrontmatter] = useState<FrontmatterValue>({
    title: document.title,
    status: document.status,
    confidenceLevel: document.confidenceLevel,
    ownerId: document.ownerId,
  });

  const editor = useFrontmatterEditor({
    documentId: document.id,
    initialContent: document.content,
    docType: document.type,
    canEdit: true,
  });

  const onFrontmatterChange = useCallback(
    (patch: Partial<FrontmatterValue>) => {
      setFrontmatter((prev) => ({ ...prev, ...patch }));
      editor.onFieldPatch(patch);
    },
    [editor],
  );

  const breadcrumb = [
    { label: 'Brain', href: '/brain' },
    { label: frontmatter.title || 'Untitled' },
  ];

  return (
    <>
      <div className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          {breadcrumb.map((c, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={i} className={isLast ? 'cur' : undefined}>
                {c.href && !isLast ? <Link href={c.href}>{c.label}</Link> : c.label}
                {!isLast && <span> / </span>}
              </span>
            );
          })}
        </nav>
        <div className="topbar-spacer" />
        <div className="flex items-center gap-3 text-xs">
          <SaveIndicator state={editor.saveState} />
        </div>
        <Link
          href={`/brain/${document.id}`}
          className="icon-btn"
          title="Close editor"
          aria-label="Close editor"
        >
          <XIcon className="size-4" />
        </Link>
        <ThemeToggle />
      </div>

      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 rounded-lg border border-border bg-background p-6">
            <input
              type="text"
              value={frontmatter.title}
              onChange={(e) => onFrontmatterChange({ title: e.target.value })}
              placeholder="Untitled"
              className="mb-4 w-full border-0 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
            />
            <TiptapEditor
              initialContent={editor.initialHtml}
              placeholder="Start writing…"
              onUpdate={editor.onBodyHtmlChange}
            />
            <button
              type="button"
              onClick={() => router.push(`/brain/${document.id}`)}
              className="sr-only"
            >
              Done
            </button>
          </div>

          <div className="space-y-4">
            {editor.panelState.schema && (
              <FrontmatterPanel
                schema={editor.panelState.schema}
                value={editor.panelState.value}
                rawYaml={editor.panelState.rawYaml}
                mode={editor.panelState.mode}
                canEdit={editor.canEdit}
                onFieldsChange={editor.onPanelChange}
                onRawChange={editor.onRawChange}
                onModeChange={editor.onModeChange}
                error={editor.panelState.error}
              />
            )}
            <FrontmatterSidebar
              value={frontmatter}
              owners={owners}
              onChange={onFrontmatterChange}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  switch (state) {
    case 'idle':
      return <span className="text-muted-foreground">Ready</span>;
    case 'pending':
      return <span className="text-muted-foreground">Editing…</span>;
    case 'saving':
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <LoaderIcon className="size-3 animate-spin" />
          Saving…
        </span>
      );
    case 'saved':
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CheckIcon className="size-3" />
          Saved
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-destructive">
          <XCircleIcon className="size-3" />
          Failed to save
        </span>
      );
  }
}

'use client';

// The edit surface. Wires Tiptap (HTML in/out) to a markdown-on-the-wire
// PATCH endpoint, plus the frontmatter sidebar. Auto-saves with a 500 ms
// debounce; a single PATCH carries whatever fields have changed since the
// last save.
//
// We intentionally do not round-trip HTML ↔ Markdown on every keystroke:
// the Tiptap editor is authoritative for HTML during the session, and we
// convert to Markdown only at save-time (turndown runs once per debounce).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { CheckIcon, LoaderIcon, XIcon, XCircleIcon } from 'lucide-react';

import { TiptapEditor } from '@/components/editor/tiptap-editor';
import {
  FrontmatterSidebar,
  type FrontmatterValue,
} from './frontmatter-sidebar';

interface DocumentData {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'active' | 'archived';
  confidenceLevel: 'high' | 'medium' | 'low';
  ownerId: string | null;
}

interface UserOption {
  id: string;
  label: string;
}

interface Props {
  document: DocumentData;
  owners: UserOption[];
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// Anything in this shape can land in a PATCH body.
type PendingPatch = Partial<FrontmatterValue & { content: string }>;

const DEBOUNCE_MS = 500;

// Turndown instance is expensive to construct; memoize at module scope.
// It only runs client-side (this file is a client component).
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export function DocumentEditor({ document, owners }: Props) {
  const router = useRouter();

  const [frontmatter, setFrontmatter] = useState<FrontmatterValue>({
    title: document.title,
    status: document.status,
    confidenceLevel: document.confidenceLevel,
    ownerId: document.ownerId,
  });

  // Initial HTML for Tiptap — convert once from the markdown the server gave us.
  const initialHtml = useMemo(
    () => marked.parse(document.content, { async: false }) as string,
    [document.content],
  );

  // Live HTML from Tiptap; kept in a ref so the debounce timer can read the
  // latest value without re-subscribing.
  const latestHtml = useRef<string>(initialHtml);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const pending = useRef<PendingPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    timer.current = null;

    if (Object.keys(patch).length === 0) return;

    setSaveState('saving');
    try {
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.status !== undefined) body.status = patch.status;
      if (patch.confidenceLevel !== undefined)
        body.confidenceLevel = patch.confidenceLevel;
      if (patch.ownerId !== undefined) body.ownerId = patch.ownerId;
      if (patch.content !== undefined) body.content = patch.content;

      const res = await fetch(`/api/brain/documents/${document.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState('saved');
    } catch (err) {
      console.error('[editor] save failed', err);
      setSaveState('error');
    }
  }, [document.id]);

  const schedule = useCallback(
    (patch: PendingPatch) => {
      pending.current = { ...pending.current, ...patch };
      setSaveState('pending');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  // Frontmatter changes: update local state + schedule save.
  const onFrontmatterChange = useCallback(
    (patch: Partial<FrontmatterValue>) => {
      setFrontmatter((prev) => ({ ...prev, ...patch }));
      schedule(patch);
    },
    [schedule],
  );

  // Tiptap updates: convert HTML → Markdown, schedule save.
  const onHtmlUpdate = useCallback(
    (html: string) => {
      latestHtml.current = html;
      const md = turndown.turndown(html);
      schedule({ content: md });
    },
    [schedule],
  );

  // Flush pending saves on unmount to avoid losing work.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void flush();
      }
    };
  }, [flush]);

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
          <SaveIndicator state={saveState} />
        </div>
        <Link
          href={`/brain/${document.id}`}
          className="icon-btn"
          title="Close editor"
          aria-label="Close editor"
        >
          <XIcon className="size-4" />
        </Link>
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
              initialContent={initialHtml}
              placeholder="Start writing…"
              onUpdate={onHtmlUpdate}
            />
            <button
              type="button"
              onClick={() => router.push(`/brain/${document.id}`)}
              className="sr-only"
            >
              Done
            </button>
          </div>

          <FrontmatterSidebar
            value={frontmatter}
            owners={owners}
            onChange={onFrontmatterChange}
          />
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

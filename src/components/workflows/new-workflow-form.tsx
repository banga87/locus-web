'use client';

// NewWorkflowForm — client component. Creates a new `type: workflow`
// document via POST /api/brain/documents, then redirects to edit.
//
// Pre-seeds the document content with the canonical workflow frontmatter
// block so it passes validateWorkflowFrontmatter on first trigger without
// any manual YAML editing. The user edits the description body in Tiptap.
//
// Mirrors the structure of <NewDocumentForm> in src/components/brain/.

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import TurndownService from 'turndown';
import useSWR from 'swr';

import { workflowSchema } from '@/lib/frontmatter/schemas/workflow';
import { joinFrontmatter } from '@/lib/frontmatter/markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import {
  flattenTree,
  indentLabel,
} from '@/components/brain/folder-dialogs';
import type { ManifestFolder } from '@/lib/brain/manifest';

// UI sentinel for "no custom agent selected" — distinct from the
// reserved PLATFORM_AGENT_SLUG constant (which is the canonical slug
// the runner uses). Radix <SelectItem> rejects value="", so we need
// a non-empty sentinel that can't collide with a real slug.
const PLATFORM_AGENT_SENTINEL = '__platform__';

interface AgentOption {
  id: string;
  title: string;
  slug: string;
}

interface AgentsResponse {
  agents: AgentOption[];
}

// TODO: consolidate with the near-identical fetcher in
// src/components/chat/session-sidebar.tsx when a third caller lands.
const agentsFetcher = async (url: string): Promise<AgentsResponse> => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body?.data?.agents || !Array.isArray(body.data.agents)) {
    throw new Error('Unexpected /api/agents response shape');
  }
  return body.data as AgentsResponse;
};

interface Props {
  folders: ManifestFolder[];
}

const WORKFLOW_BODY_PLACEHOLDER =
  'Describe what this workflow should do, which docs it should consult, and what output it should produce.';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export function NewWorkflowForm({ folders }: Props) {
  const router = useRouter();
  const flat = useMemo(() => flattenTree(folders), [folders]);
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState(flat[0]?.id ?? '');
  // Sentinel-initialised — Radix Select forbids value="" on SelectItem,
  // so we keep a non-empty placeholder here and map it back to "no
  // override" (agent: null in the seed frontmatter) on submit.
  const [selectedAgent, setSelectedAgent] = useState(PLATFORM_AGENT_SENTINEL);
  const htmlRef = useRef<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: agentsData,
    error: agentsError,
    isLoading: agentsLoading,
  } = useSWR<AgentsResponse>('/api/agents', agentsFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmed = title.trim();
      if (!trimmed) {
        setError('Title is required.');
        return;
      }
      if (!folderId) {
        setError(
          'No folders found. Create a folder in the Brain first, then retry.',
        );
        return;
      }
      const slug = slugify(trimmed);
      if (!slug) {
        setError('Title must contain at least one letter or number.');
        return;
      }

      setSubmitting(true);

      // Build document content: schema defaults frontmatter + body.
      // If no agent was selected keep the default (agent: null); if one
      // was selected, spread its slug into the seed so the YAML is
      // pre-populated on first open.
      const bodyMd = htmlRef.current
        ? turndown.turndown(htmlRef.current)
        : WORKFLOW_BODY_PLACEHOLDER;
      const seedFrontmatter =
        selectedAgent === PLATFORM_AGENT_SENTINEL || selectedAgent === ''
          ? workflowSchema.defaults()
          : { ...workflowSchema.defaults(), agent: selectedAgent };
      const content = joinFrontmatter(seedFrontmatter, bodyMd, workflowSchema);

      try {
        const res = await fetch('/api/brain/documents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: trimmed, slug, content, folderId }),
        });

        if (!res.ok) {
          const body = (await res.json()) as { message?: string; error?: string };
          throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
        }

        // The POST response's `data` envelope carries the full document
        // row (see src/lib/api/response.ts::created). We use the slug to
        // land the user on /workflows/[slug] — the workflow detail page —
        // rather than the generic /brain/[id]/edit so context is preserved.
        const payload = (await res.json()) as {
          data: { id: string; slug: string };
        };
        router.push(`/workflows/${payload.data.slug}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to create workflow.',
        );
        setSubmitting(false);
      }
    },
    [title, folderId, selectedAgent, router],
  );

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8"
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          New workflow
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Give it a title and describe what it should do. Frontmatter
          (output type, required MCPs) is pre-seeded — edit it in the
          document body after creation.
        </p>
      </header>

      <div className="space-y-2">
        <Label htmlFor="wf-title">Title</Label>
        <Input
          id="wf-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Weekly report generator"
          autoFocus
        />
      </div>

      {flat.length > 0 && (
        <div className="space-y-2">
          <Label>Folder</Label>
          <Select
            value={folderId}
            onValueChange={(v) => setFolderId(v ?? '')}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick a folder" />
            </SelectTrigger>
            <SelectContent>
              {flat.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {indentLabel(f.name, f.depth)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="wf-run-as">Run as</Label>
        <div className="flex items-center gap-3">
          <Select
            value={selectedAgent}
            onValueChange={(v) => setSelectedAgent(v ?? '')}
            disabled={agentsLoading}
          >
            <SelectTrigger id="wf-run-as" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PLATFORM_AGENT_SENTINEL}>
                Platform agent (unrestricted)
              </SelectItem>
              {agentsData?.agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.slug}>
                  {agent.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {agentsError && (
            <span className="shrink-0 text-sm text-muted-foreground">
              Couldn&apos;t load agents.
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <div className="rounded-lg border border-border bg-background p-4">
          <TiptapEditor
            placeholder={WORKFLOW_BODY_PLACEHOLDER}
            onUpdate={(h) => {
              htmlRef.current = h;
            }}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" asChild>
          <Link href="/workflows">Cancel</Link>
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create & edit'}
        </Button>
      </div>
    </form>
  );
}

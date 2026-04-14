'use client';

// New document form. Minimal fields: title, category, body. Slug is derived
// client-side from the title so the user doesn't have to think about it.
// The body is a Tiptap editor so the initial draft uses the same WYSIWYG
// surface the editor does.

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import TurndownService from 'turndown';

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

interface Category {
  id: string;
  name: string;
}

interface Props {
  categories: Category[];
}

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

export function NewDocumentForm({ categories }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const html = useRef<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmed = title.trim();
      if (!trimmed) {
        setError('Title is required.');
        return;
      }
      const slug = slugify(trimmed);
      if (!slug) {
        setError('Title must contain at least one letter or number.');
        return;
      }
      if (!categoryId) {
        setError('Pick a category.');
        return;
      }

      setSubmitting(true);
      try {
        const markdown = turndown.turndown(html.current);
        const res = await fetch('/api/brain/documents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: trimmed,
            slug,
            content: markdown,
            categoryId,
          }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          const msg = payload?.error?.message ?? `Failed to create (HTTP ${res.status}).`;
          throw new Error(msg);
        }
        const payload = (await res.json()) as { data: { id: string } };
        router.push(`/brain/${payload.data.id}/edit`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create document.');
        setSubmitting(false);
      }
    },
    [title, categoryId, router],
  );

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New document</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a category, give it a title, and start writing. You can tweak
          everything later.
        </p>
      </header>

      <div className="space-y-2">
        <Label htmlFor="new-doc-title">Title</Label>
        <Input
          id="new-doc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Refund policy"
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Select
          value={categoryId}
          onValueChange={(v) => setCategoryId(v ?? '')}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick a category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Body</Label>
        <div className="rounded-lg border border-border bg-background p-4">
          <TiptapEditor
            placeholder="Start writing…"
            onUpdate={(h) => {
              html.current = h;
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
          <Link href="/brain">Cancel</Link>
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create & edit'}
        </Button>
      </div>
    </form>
  );
}

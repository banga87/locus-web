'use client';

// SkillDetailClient — client wrapper for the /skills/[id] detail page.
//
// Holds the selected-file state and wires tree + viewer together.
// Also owns the header action buttons (Fork, Update, Delete) which
// require client-side navigation/state.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { FileTree } from './file-tree';
import { FileViewer } from './file-viewer';
import { ForkButton } from './fork-button';
import { UpdateModal } from './update-modal';
import { AddFileInline } from './add-file-inline';
import type { SkillOrigin } from '@/lib/skills/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RootSkillData {
  id: string;
  title: string;
  description: string | null;
  body: string;          // SKILL.md body (frontmatter stripped)
  origin: SkillOrigin;
  updatedAt: Date;
}

export interface ResourceData {
  id: string;
  title: string;
  relativePath: string | null;
  content: string;
}

interface SkillDetailClientProps {
  root: RootSkillData;
  resources: ResourceData[];
  agentCount: number;
  canEdit: boolean;
}

// ─── Origin badge ─────────────────────────────────────────────────────────────

function originBadgeText(origin: SkillOrigin): string {
  switch (origin.kind) {
    case 'installed': {
      const base = `github.com/${origin.owner}/${origin.repo}`;
      const suffix = origin.skill ? `/skills/${origin.skill}` : '';
      return `Installed from ${base}${suffix}`;
    }
    case 'forked':
      return `Forked from ${origin.from}`;
    case 'authored':
      return 'Authored';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SkillDetailClient({
  root,
  resources,
  agentCount,
  canEdit,
}: SkillDetailClientProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(root.id);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addingFile, setAddingFile] = useState(false);

  // authored or forked skills can have files edited
  const canEditFiles = canEdit && (root.origin.kind === 'authored' || root.origin.kind === 'forked');

  // Resolve the selected file's content + filename + relativePath for the PATCH URL.
  const selectedFile = (() => {
    if (selectedId === root.id) {
      return { content: root.body, filename: 'SKILL.md', relativePath: 'SKILL.md' };
    }
    const res = resources.find((r) => r.id === selectedId);
    if (!res) return { content: root.body, filename: 'SKILL.md', relativePath: 'SKILL.md' };
    if (!res.relativePath) {
      console.error('[SkillDetailClient] resource missing relativePath', { id: res.id, title: res.title });
      return { content: res.content, filename: res.title, relativePath: null };
    }
    return {
      content: res.content,
      filename: res.relativePath,
      relativePath: res.relativePath,
    };
  })();

  // Build file list for the tree
  const rootFile = { id: root.id, name: 'SKILL.md', relativePath: null };
  const treeResources = resources.map((r) => ({
    id: r.id,
    name: r.title,
    relativePath: r.relativePath,
  }));

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/skills/${root.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteDialogOpen(false);
        router.push('/skills');
      } else {
        setDeleteError('Failed to delete skill. Please try again.');
      }
    } catch {
      setDeleteError('An unexpected error occurred. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <div className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href="/skills" className="crumb">Skills</a>
          <span className="cur">{root.title}</span>
        </nav>
        <div className="topbar-spacer" />
        <div className="flex items-center gap-2">
          {root.origin.kind === 'installed' && canEdit && (
            <>
              <ForkButton skillId={root.id} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUpdateModalOpen(true)}
              >
                Update
              </Button>
            </>
          )}
          {canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={deleting}
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2Icon className="mr-1.5 size-3.5" />
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
              <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Delete skill?</DialogTitle>
                    <DialogDescription>
                      This will permanently remove &ldquo;{root.title}&rdquo; and all its
                      resource files. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  {deleteError && (
                    <p className="text-sm text-destructive px-1">{deleteError}</p>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={deleting}
                      onClick={handleDelete}
                    >
                      {deleting ? 'Deleting…' : 'Delete'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {/* Page body */}
      <div className="article-wrap flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-6xl px-6 py-6 h-full flex flex-col gap-4">
          {/* Header */}
          <header className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1
                  className="text-2xl text-ink"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                >
                  {root.title}
                </h1>
                {root.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {root.description}
                  </p>
                )}
              </div>
              <Badge variant="outline" className="shrink-0 text-xs font-normal mt-1">
                {originBadgeText(root.origin)}
              </Badge>
            </div>
          </header>

          {/* Two-pane: tree (30%) + viewer (70%) */}
          <div className="flex-1 min-h-0 flex gap-0 rounded-lg border border-border overflow-hidden">
            {/* File tree — left */}
            <div className="w-[30%] border-r border-border overflow-y-auto bg-muted/20 px-2">
              <FileTree
                rootFile={rootFile}
                resources={treeResources}
                selectedId={selectedId}
                onSelect={setSelectedId}
                canEdit={canEditFiles}
                onAddFileClick={() => setAddingFile(true)}
              />
              {/* Add file inline form — shown below the tree when active */}
              {addingFile && (
                <AddFileInline
                  skillId={root.id}
                  onSaved={() => setAddingFile(false)}
                  onCancel={() => setAddingFile(false)}
                />
              )}
            </div>

            {/* File viewer — right */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {selectedFile.relativePath !== null ? (
                <FileViewer
                  content={selectedFile.content}
                  filename={selectedFile.filename}
                  canEdit={canEditFiles}
                  skillId={root.id}
                  relativePath={selectedFile.relativePath}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  (missing path)
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <footer className="text-xs text-muted-foreground">
            Used by{' '}
            <span className="font-medium text-foreground">
              {agentCount} {agentCount === 1 ? 'agent' : 'agents'}
            </span>
          </footer>
        </div>
      </div>

      {/* Update modal — only for installed skills */}
      {root.origin.kind === 'installed' && (
        <UpdateModal
          skillId={root.id}
          open={updateModalOpen}
          onOpenChange={setUpdateModalOpen}
        />
      )}
    </div>
  );
}

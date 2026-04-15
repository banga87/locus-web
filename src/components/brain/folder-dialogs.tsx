'use client';

// Folder CRUD + document-move dialogs for the Brain sidebar context menu.
//
// Each dialog is a controlled component — parent owns `open` state and
// passes `onOpenChange`. This lets `BrainTree` keep a single `dialogState`
// slice and render one dialog instance at a time, avoiding a pile of
// mounted Radix portals.
//
// Error messages bubble verbatim from the server actions (which throw
// Error with stable prefixes like `'slug conflict: ...'`, `'folder has
// children'`, etc. — see `src/lib/brain/folders.ts`). We keep this simple
// and show the raw message; if users find them confusing, we'll swap to
// prefix-matching friendlier copy later.

import { useState, useTransition } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createFolderAction,
  deleteFolderAction,
  moveDocumentAction,
  renameFolderAction,
} from '@/app/(app)/brain/actions';
import type { ManifestFolder } from '@/lib/brain/manifest';

// ---------------------------------------------------------------------------
// Tree flatten helper — shared with <NewDocumentForm> via a named export so
// we don't duplicate the recursion. Render callers format the indentation
// (u00A0 non-breaking spaces, em-dashes, etc.) from `depth`.
// ---------------------------------------------------------------------------

export interface FlatFolder {
  id: string;
  name: string;
  depth: number;
}

export function flattenTree(
  tree: ManifestFolder[],
  depth = 0,
): FlatFolder[] {
  const result: FlatFolder[] = [];
  for (const f of tree) {
    result.push({ id: f.id, name: f.name, depth });
    result.push(...flattenTree(f.folders, depth + 1));
  }
  return result;
}

// Non-breaking space × 2 per depth level. Using `\u00A0` rather than
// regular spaces so `<SelectItem>`'s text layout doesn't collapse the
// indentation.
export function indentLabel(name: string, depth: number): string {
  if (depth === 0) return name;
  return `${'\u00A0\u00A0'.repeat(depth)}${name}`;
}

// ---------------------------------------------------------------------------
// Create folder
// ---------------------------------------------------------------------------

export interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string | null;
  parentName: string | null; // null => top-level
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentId,
  parentName,
}: CreateFolderDialogProps) {
  // State lives for the lifetime of the mounted dialog. BrainTree unmounts
  // this component when the dialog closes (it's conditionally rendered
  // inside `{dialog.type === 'create' && …}`) so there's no need for an
  // open-toggle useEffect to reset values.
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      try {
        await createFolderAction({ parentId, name: trimmed });
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create folder');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            {parentName
              ? `Creates a folder inside "${parentName}".`
              : 'Creates a top-level folder.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="folder-name">Name</Label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Product & Service"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !name.trim()}
          >
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Rename folder
// ---------------------------------------------------------------------------

export interface RenameFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  currentName: string;
}

export function RenameFolderDialog({
  open,
  onOpenChange,
  folderId,
  currentName,
}: RenameFolderDialogProps) {
  // Dialog is conditionally mounted by the parent (BrainTree / NewSidebar),
  // so first-render initial state is the prefilled name. No effect needed.
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === currentName) {
      onOpenChange(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await renameFolderAction(folderId, trimmed);
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to rename folder');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename folder</DialogTitle>
          <DialogDescription>
            Renaming a folder updates its slug. Links to this folder by path
            may need a refresh.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="rename-folder-name">Name</Label>
          <Input
            id="rename-folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !name.trim()}
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete folder
// ---------------------------------------------------------------------------

export interface DeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string;
  folderName: string;
  hasChildren: boolean;
  hasDocuments: boolean;
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  folderId,
  folderName,
  hasChildren,
  hasDocuments,
}: DeleteFolderDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const blocked = hasChildren || hasDocuments;

  const handleDelete = () => {
    if (blocked) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteFolderAction(folderId);
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete folder');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete folder</DialogTitle>
          <DialogDescription>
            {blocked ? (
              <>
                &ldquo;{folderName}&rdquo; can&rsquo;t be deleted because it
                still contains{' '}
                {hasChildren && hasDocuments
                  ? 'sub-folders and documents'
                  : hasChildren
                    ? 'sub-folders'
                    : 'documents'}
                . Move or delete them first.
              </>
            ) : (
              <>
                Delete &ldquo;{folderName}&rdquo;? This cannot be undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={pending || blocked}
          >
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Move document
// ---------------------------------------------------------------------------

export interface MoveDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  tree: ManifestFolder[];
  currentFolderId: string;
}

export function MoveDocumentDialog({
  open,
  onOpenChange,
  documentId,
  tree,
  currentFolderId,
}: MoveDocumentDialogProps) {
  const flat = flattenTree(tree).filter((f) => f.id !== currentFolderId);
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = () => {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      try {
        await moveDocumentAction(documentId, selected);
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to move document');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move document</DialogTitle>
          <DialogDescription>
            Pick a destination folder. Moving does not rewrite the document
            path until the next save.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="move-dest">Destination</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger id="move-dest" className="w-full">
              <SelectValue placeholder="Pick a folder…" />
            </SelectTrigger>
            <SelectContent>
              {flat.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No other folders available
                </SelectItem>
              ) : (
                flat.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {indentLabel(f.name, f.depth)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !selected}
          >
            {pending ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

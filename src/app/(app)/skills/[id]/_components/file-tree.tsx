'use client';

// FileTree — left-pane navigation for the skill detail page.
//
// Builds a nested tree from the flat resources list by splitting relative_path
// on '/'. Clicking a leaf sets the selected-file state via onSelect.
//
// Props:
//   rootFile   — the SKILL.md root entry (always at the top).
//   resources  — flat list of skill-resource rows.
//   selectedId — currently selected file id.
//   onSelect   — callback invoked with the selected file id.
//   canEdit    — show "+ Add file" affordance (authored/forked only).
//
// Note: "+ Add file" is rendered as an inert button in Task 24.
// The add-file implementation lands in Task 25.

import { useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon, FileIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileTreeFile {
  id: string;
  name: string;
  relativePath: string | null;
}

interface FileTreeProps {
  rootFile: FileTreeFile;
  resources: FileTreeFile[];
  selectedId: string;
  onSelect: (id: string) => void;
  canEdit: boolean;
  /** Called when the user clicks "+ Add file". Controller in parent. */
  onAddFileClick?: () => void;
}

// ─── Tree node shapes ────────────────────────────────────────────────────────

interface LeafNode {
  kind: 'leaf';
  id: string;
  label: string;
}

interface DirectoryNode {
  kind: 'dir';
  name: string;
  children: TreeNode[];
}

type TreeNode = LeafNode | DirectoryNode;

// ─── Tree builder ────────────────────────────────────────────────────────────

function buildTree(resources: FileTreeFile[]): TreeNode[] {
  const nodes: TreeNode[] = [];
  // Keyed by directory path for de-duplication.
  const dirMap = new Map<string, DirectoryNode>();

  for (const res of resources) {
    const path = res.relativePath ?? res.name;
    const segments = path.split('/');

    if (segments.length === 1) {
      // Flat file at the root of the skill.
      nodes.push({ kind: 'leaf', id: res.id, label: path });
    } else {
      // Nested file — insert into a directory group.
      const dirName = segments[0];
      const fileName = segments.slice(1).join('/');

      if (!dirMap.has(dirName)) {
        const dir: DirectoryNode = { kind: 'dir', name: dirName, children: [] };
        dirMap.set(dirName, dir);
        nodes.push(dir);
      }

      dirMap.get(dirName)!.children.push({
        kind: 'leaf',
        id: res.id,
        label: fileName,
      });
    }
  }

  return nodes;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface LeafRowProps {
  id: string;
  label: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  depth?: number;
}

function LeafRow({ id, label, isSelected, onSelect, depth = 0 }: LeafRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        'w-full flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        isSelected
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-foreground/80',
      )}
      style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
    >
      <FileIcon className="size-3.5 shrink-0 opacity-60" />
      <span className="truncate font-mono text-xs">{label}</span>
    </button>
  );
}

interface DirRowProps {
  name: string;
  children: TreeNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  depth?: number;
}

function DirRow({ name, children, selectedId, onSelect, depth = 0 }: DirRowProps) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
        aria-expanded={open}
      >
        <Chevron className="size-3.5 shrink-0" />
        <span>{name}</span>
      </button>
      {open && (
        <div>
          {children.map((child) =>
            child.kind === 'leaf' ? (
              <LeafRow
                key={child.id}
                id={child.id}
                label={child.label}
                isSelected={selectedId === child.id}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ) : (
              <DirRow
                key={child.name}
                name={child.name}
                children={child.children}
                selectedId={selectedId}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ─── FileTree ────────────────────────────────────────────────────────────────

export function FileTree({
  rootFile,
  resources,
  selectedId,
  onSelect,
  canEdit,
  onAddFileClick,
}: FileTreeProps) {
  const nodes = buildTree(resources);

  return (
    <nav
      className="flex flex-col gap-0.5 py-2"
      aria-label="Skill file tree"
    >
      {/* SKILL.md root entry — always first */}
      <LeafRow
        id={rootFile.id}
        label="SKILL.md"
        isSelected={selectedId === rootFile.id}
        onSelect={onSelect}
        depth={0}
      />

      {/* Resource tree */}
      {nodes.map((node) =>
        node.kind === 'leaf' ? (
          <LeafRow
            key={node.id}
            id={node.id}
            label={node.label}
            isSelected={selectedId === node.id}
            onSelect={onSelect}
            depth={0}
          />
        ) : (
          <DirRow
            key={node.name}
            name={node.name}
            children={node.children}
            selectedId={selectedId}
            onSelect={onSelect}
            depth={0}
          />
        ),
      )}

      {/* Add file affordance */}
      {canEdit && (
        <button
          type="button"
          onClick={onAddFileClick}
          className="mt-2 flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          + Add file
        </button>
      )}
    </nav>
  );
}

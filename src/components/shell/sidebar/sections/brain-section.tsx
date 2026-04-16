'use client';

import { useState } from 'react';
import { Brain, Plus } from 'lucide-react';

import type { ManifestFolder } from '@/lib/brain/manifest';
import { BrainTree } from '@/components/shell/brain-tree';
import { CreateFolderDialog } from '@/components/brain/folder-dialogs';
import { Section } from '@/components/shell/sidebar/section';
import { useSidebarLayout } from '@/lib/sidebar/use-sidebar-layout';

function countDocs(folders: ManifestFolder[]): number {
  let n = 0;
  for (const f of folders) n += f.documents.length + countDocs(f.folders);
  return n;
}

interface BrainSectionProps {
  tree: ManifestFolder[];
}

export function BrainSection({ tree }: BrainSectionProps) {
  const { sections, toggleSection } = useSidebarLayout();
  const [createOpen, setCreateOpen] = useState(false);

  const action = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setCreateOpen(true);
      }}
      aria-label="New top-level folder"
      className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Plus size={12} />
    </button>
  );

  return (
    <>
      <Section
        id="brain"
        icon={Brain}
        label="Brain"
        count={countDocs(tree)}
        headerAction={action}
        expanded={sections.brain ?? true}
        onToggle={() => toggleSection('brain')}
      >
        <BrainTree tree={tree} />
      </Section>
      {createOpen && (
        <CreateFolderDialog
          open
          onOpenChange={setCreateOpen}
          parentId={null}
          parentName={null}
        />
      )}
    </>
  );
}

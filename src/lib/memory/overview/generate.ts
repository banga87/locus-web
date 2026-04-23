// src/lib/memory/overview/generate.ts
//
// Bottom-up folder rollup. Produces the markdown body of an auto-
// generated `_OVERVIEW.md` document. Pure function — caller supplies
// the folder contents and this returns a string.

import type { CompactIndex } from '../types';

export interface OverviewChild {
  path: string;
  title: string;
  compact_index: CompactIndex | null;
}

export interface GenerateInput {
  folderPath: string;
  children: OverviewChild[];
  childFolders: string[];
}

export function generateFolderOverview(input: GenerateInput): string {
  const parts: string[] = [];
  parts.push(`# Overview: ${input.folderPath}`);
  parts.push('');
  parts.push(
    '> Auto-generated summary of this folder. Regenerated on document-change events.',
  );
  parts.push('');

  if (input.childFolders.length > 0) {
    parts.push('## Subfolders');
    for (const f of input.childFolders) parts.push(`- ${f}`);
    parts.push('');
  }

  if (input.children.length > 0) {
    parts.push('## Documents');
    for (const c of input.children) {
      const ks = c.compact_index?.key_sentence ?? '';
      parts.push(`- **${c.title}** (\`${c.path}\`)${ks ? ` — ${ks}` : ''}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

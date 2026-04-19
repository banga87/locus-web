'use client';

// SkillPreviewView — renders a read-only preview of a SkillPreview returned
// by POST /api/skills/import/preview. Shared by the Install modal (Task 23)
// and the Update modal (Task 24).

import { ScrollArea } from '@/components/ui/scroll-area';
import type { SkillPreview } from '@/lib/skills/github-import';

interface OriginPin {
  owner: string;
  repo: string;
  skillName: string | null;
  sha: string;
}

interface SkillPreviewViewProps {
  preview: SkillPreview;
  origin: OriginPin;
}

export function SkillPreviewView({ preview, origin }: SkillPreviewViewProps) {
  const repoPath = `${origin.owner}/${origin.repo}`;
  const skillSuffix = origin.skillName ? `/skills/${origin.skillName}` : '';
  const shaShort = origin.sha.slice(0, 7);

  const allFiles = [
    'SKILL.md',
    ...preview.resources.map((r) => r.relative_path),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Safety notice — destructive style without an Alert component */}
      <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <strong className="font-medium">Review before installing.</strong>{' '}
        This content will become part of your agents&apos; instructions. Review it before
        installing.
      </div>

      {/* Name + description */}
      <div>
        <h3 className="text-base font-semibold text-ink">{preview.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{preview.description}</p>
      </div>

      {/* Origin pin */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
        <span>
          github.com/{repoPath}
          {skillSuffix}
        </span>
        <span>·</span>
        <span title={origin.sha}>{shaShort}</span>
      </div>

      {/* File tree */}
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Files
        </p>
        <ul className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-mono space-y-0.5">
          {allFiles.map((path) => (
            <li key={path} className="text-foreground/80">
              {path}
            </li>
          ))}
        </ul>
      </div>

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-600">
            Warnings
          </p>
          <ul className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs space-y-0.5 dark:border-amber-800 dark:bg-amber-950/30">
            {preview.warnings.map((w, i) => (
              <li key={i} className="text-amber-700 dark:text-amber-400">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SKILL.md body — scrollable */}
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          SKILL.md
        </p>
        <ScrollArea className="max-h-[40vh] rounded-md border border-border bg-muted/30">
          <pre className="whitespace-pre-wrap px-3 py-2 text-xs leading-relaxed text-foreground/80">
            {preview.skillMdBody}
          </pre>
        </ScrollArea>
      </div>
    </div>
  );
}

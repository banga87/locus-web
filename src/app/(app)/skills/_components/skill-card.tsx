// SkillCard — displays a single skill in the /skills index grid.
//
// The `origin` discriminated union drives the badge text:
//   installed → "Installed from github.com/{owner}/{repo}[/skills/{skill}]"
//   forked    → "Forked from {from}"
//   authored  → "Authored"

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { formatDistance } from '@/lib/format/time';
import type { SkillOrigin } from '@/lib/skills/types';

export type { SkillOrigin };

interface SkillCardProps {
  id: string;
  title: string;
  description: string | null;
  origin: SkillOrigin;
  resourceCount: number;
  agentCount: number;
  updatedAt: Date;
}

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

export function SkillCard({
  id,
  title,
  description,
  origin,
  resourceCount,
  agentCount,
  updatedAt,
}: SkillCardProps) {
  const badgeText = originBadgeText(origin);
  const truncatedDesc =
    description && description.length > 200
      ? `${description.slice(0, 200)}…`
      : description;

  return (
    <Link
      href={`/skills/${id}`}
      className="rounded-lg border border-border bg-card px-5 py-4 flex flex-col gap-3 transition-colors hover:bg-accent/40 hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium text-ink leading-snug">{title}</h3>
        <Badge variant="outline" className="shrink-0 text-xs font-normal">
          {badgeText}
        </Badge>
      </div>

      {/* Description */}
      {truncatedDesc && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {truncatedDesc}
        </p>
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center gap-4 text-xs text-muted-foreground font-mono uppercase tracking-wide">
        <span>{resourceCount} resources</span>
        <span>·</span>
        <span>Used by {agentCount} agents</span>
        <span>·</span>
        <span>{formatDistance(updatedAt)}</span>
      </div>
    </Link>
  );
}

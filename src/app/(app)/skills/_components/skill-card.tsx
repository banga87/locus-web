// SkillCard — displays a single skill in the /skills index grid.
//
// The `origin` discriminated union drives the badge text:
//   installed → "Installed from github.com/{owner}/{repo}[/skills/{skill}]"
//   forked    → "Forked from {from}"
//   authored  → "Authored"
//
// Task 6 additions:
//   - Triggerable skills get a subtle "Triggerable" pill marker next to
//     the title and a "Last run" status line in the footer.
//   - Non-triggerable cards render exactly as before.

import Link from 'next/link';
import { ZapIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { formatDistance } from '@/lib/format/time';
import type { SkillOrigin } from '@/lib/skills/types';

export type { SkillOrigin };

type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'queued';

interface LastRun {
  id: string;
  status: RunStatus;
  startedAt: Date;
}

interface SkillCardProps {
  id: string;
  title: string;
  description: string | null;
  origin: SkillOrigin;
  resourceCount: number;
  agentCount: number;
  updatedAt: Date;
  /** True when the skill has a `trigger:` block in metadata. */
  isTriggerable?: boolean;
  /** Most recent run for a triggerable skill (null if never run). */
  lastRun?: LastRun | null;
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

function runStatusVariant(
  status: RunStatus,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'running':
    case 'queued':
      return 'secondary';
    case 'failed':
    case 'cancelled':
      return 'destructive';
    default:
      return 'outline';
  }
}

function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'queued':
      return 'Queued';
    default:
      return status;
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
  isTriggerable = false,
  lastRun = null,
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
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-base font-medium text-ink leading-snug truncate">
            {title}
          </h3>
          {isTriggerable && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              title="This skill can be triggered to run on demand."
            >
              <ZapIcon className="size-3" aria-hidden="true" />
              Triggerable
            </span>
          )}
        </div>
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

      {/* Last-run line (triggerable only) */}
      {isTriggerable && (
        <div className="text-xs text-muted-foreground">
          {lastRun ? (
            <span className="inline-flex items-center gap-2">
              <span>Last run</span>
              <Badge variant={runStatusVariant(lastRun.status)}>
                {runStatusLabel(lastRun.status)}
              </Badge>
              <span>· {formatDistance(lastRun.startedAt)}</span>
            </span>
          ) : (
            <span>Never run</span>
          )}
        </div>
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

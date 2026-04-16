// WorkflowList — server-renderable table of workflow documents.
// Each row shows title, output category, last-run status badge, and a RunButton.

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { RunButton } from './run-button';

type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'queued';

interface LastRun {
  id: string;
  status: RunStatus;
  startedAt: Date;
}

interface WorkflowRow {
  id: string;
  slug: string;
  title: string;
  frontmatter: {
    output?: string;
    output_category?: string | null;
    requires_mcps?: string[];
  };
  lastRun?: LastRun;
}

interface Props {
  workflows: WorkflowRow[];
}

function statusVariant(
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

function statusLabel(status: RunStatus): string {
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

function relativeTime(date: Date): string {
  const ms = Date.now() - date.getTime();
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function WorkflowList({ workflows }: Props) {
  if (workflows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-secondary px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No workflows yet. Create one to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary text-left">
            <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">Output</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">Category</th>
            <th className="px-4 py-3 font-medium text-muted-foreground">Last run</th>
            <th className="px-4 py-3 font-medium text-muted-foreground" />
          </tr>
        </thead>
        <tbody>
          {workflows.map((wf) => (
            <tr
              key={wf.id}
              className="border-b border-border last:border-0 hover:bg-muted/40"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/workflows/${wf.slug}`}
                  className="font-medium text-ink hover:underline"
                >
                  {wf.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {wf.frontmatter.output ?? '—'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {wf.frontmatter.output_category ?? '—'}
              </td>
              <td className="px-4 py-3">
                {wf.lastRun ? (
                  <span className="flex items-center gap-2">
                    <Badge variant={statusVariant(wf.lastRun.status)}>
                      {statusLabel(wf.lastRun.status)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(wf.lastRun.startedAt)}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <RunButton workflowDocumentId={wf.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

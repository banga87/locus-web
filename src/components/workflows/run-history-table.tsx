// RunHistoryTable — lists past workflow runs for a document.
// Server-renderable (no client hooks needed).

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';

type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'queued';

interface RunRow {
  id: string;
  status: RunStatus;
  startedAt: Date;
  completedAt: Date | null;
  summary: string | null;
  totalCostUsd: string | null;
}

interface Props {
  runs: RunRow[];
  /** The workflow slug, used to build run-view links. */
  workflowSlug: string;
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

function formatDuration(start: Date, end: Date | null): string {
  if (!end) return '—';
  const ms = end.getTime() - start.getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCost(usd: string | null): string {
  if (!usd) return '—';
  const n = parseFloat(usd);
  if (isNaN(n)) return '—';
  if (n < 0.001) return '<$0.001';
  return `$${n.toFixed(3)}`;
}

export function RunHistoryTable({ runs, workflowSlug }: Props) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-secondary px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary text-left">
            <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">Status</th>
            <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">Started</th>
            <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">Duration</th>
            <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">Cost</th>
            <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">Summary</th>
            <th scope="col" className="px-4 py-3 font-medium text-muted-foreground" />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className="border-b border-border last:border-0 hover:bg-muted/40"
            >
              <td className="px-4 py-3">
                <Badge variant={statusVariant(run.status)}>
                  {statusLabel(run.status)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(run.startedAt)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDuration(run.startedAt, run.completedAt)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatCost(run.totalCostUsd)}
              </td>
              <td className="max-w-xs px-4 py-3 text-muted-foreground">
                <span className="line-clamp-1">
                  {run.summary ?? '—'}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/workflows/${workflowSlug}/runs/${run.id}`}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// RunHistoryTable — lists past run rows for a triggered skill.
//
// Relocated from src/components/workflows/run-history-table.tsx during
// the skill/workflow unification. Links now target /skills/[id]/runs/[id]
// (id-based) instead of /workflows/[slug]/runs/[id].
//
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
  /** The skill document id, used to build run-view links. */
  skillId: string;
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

export function RunHistoryTable({ runs, skillId }: Props) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-secondary px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: stacked cards. Each row becomes a self-contained block so
          columns don't fight for space. */}
      <ul className="flex flex-col gap-3 md:hidden" role="list">
        {runs.map((run) => (
          <li
            key={run.id}
            className="rounded-lg border border-border bg-background p-4"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <Badge variant={statusVariant(run.status)}>
                {statusLabel(run.status)}
              </Badge>
              <Link
                href={`/skills/${skillId}/runs/${run.id}`}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
              >
                View
              </Link>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Started</dt>
              <dd className="text-right">{formatDate(run.startedAt)}</dd>
              <dt className="text-muted-foreground">Duration</dt>
              <dd className="text-right">{formatDuration(run.startedAt, run.completedAt)}</dd>
              <dt className="text-muted-foreground">Cost</dt>
              <dd className="text-right">{formatCost(run.totalCostUsd)}</dd>
            </dl>
            {run.summary && (
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                {run.summary}
              </p>
            )}
          </li>
        ))}
      </ul>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
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
                    href={`/skills/${skillId}/runs/${run.id}`}
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
    </>
  );
}

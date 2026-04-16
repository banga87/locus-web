// GlobalRunBadge — server component rendered in the sidebar.
//
// Queries workflow_runs WHERE status='running' AND triggered_by=user.id,
// joined through documents to confirm company-level tenant isolation
// (workflow_runs has no direct company_id column).
//
// Renders a small "N running" badge next to the Workflows nav link.
// Clicking navigates to the most recent running run's view URL,
// or to /workflows if there are none.
//
// Zero active runs: renders a subtle greyed label rather than nothing,
// so the nav item stays stable in width and the user can still see
// their last-run context.

import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';
import type { AuthContext } from '@/lib/api/auth';

interface GlobalRunBadgeProps {
  auth: AuthContext;
}

export async function GlobalRunBadge({ auth }: GlobalRunBadgeProps) {
  if (!auth.companyId) return null;

  // Fetch running runs for this user, joined through documents for tenant isolation.
  // Limit to 10 — we only need the count + the most recent one's ID.
  const runningRuns = await db
    .select({
      id: workflowRuns.id,
      workflowDocumentId: workflowRuns.workflowDocumentId,
      startedAt: workflowRuns.startedAt,
      docSlug: documents.slug,
    })
    .from(workflowRuns)
    .innerJoin(documents, eq(documents.id, workflowRuns.workflowDocumentId))
    .where(
      and(
        eq(workflowRuns.status, 'running'),
        eq(workflowRuns.triggeredBy, auth.userId),
        eq(documents.companyId, auth.companyId),
      ),
    )
    .orderBy(desc(workflowRuns.startedAt))
    .limit(10);

  const count = runningRuns.length;
  const mostRecent = runningRuns[0];

  const href = mostRecent
    ? `/workflows/${mostRecent.docSlug}/runs/${mostRecent.id}`
    : '/workflows';

  if (count === 0) {
    // Subtle "no active runs" label — keeps the nav item stable.
    return (
      <Link
        href="/workflows"
        className="quick-item text-muted-foreground"
        aria-label="Workflows — no active runs"
      >
        <WorkflowsIcon />
        Workflows
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="quick-item"
      aria-label={`Workflows — ${count} run${count === 1 ? '' : 's'} active`}
    >
      <WorkflowsIcon />
      Workflows
      <span
        className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground"
        aria-hidden="true"
      >
        {count}
      </span>
    </Link>
  );
}

function WorkflowsIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="16" y="3" width="5" height="5" rx="1" />
      <rect x="9.5" y="16" width="5" height="5" rx="1" />
      <path d="M5.5 8v3a1 1 0 001 1h11a1 1 0 001-1V8" />
      <path d="M12 12v4" />
    </svg>
  );
}

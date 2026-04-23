// GlobalRunBadge — server component rendered in the sidebar.
//
// Queries workflow_runs WHERE status='running' AND triggered_by=user.id,
// joined through documents to confirm company-level tenant isolation
// (workflow_runs has no direct company_id column).
//
// The join now filters on `documents.type = 'skill'` — following the
// skill/workflow unification, triggered runs belong to skill docs. The
// workflow_runs table keeps its name (operational artefact), but the
// user-facing concept and link target is /skills.
//
// Renders a small "N running" badge next to the Skills nav link.
// Clicking navigates to the most recent running run's view URL,
// or to /skills if there are none.
//
// Zero active runs: renders a subtle greyed label rather than nothing,
// so the nav item stays stable in width and the user can still see
// their last-run context.

import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';

import { GaugeNeedle } from '@/components/tatara';
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
      docId: documents.id,
    })
    .from(workflowRuns)
    .innerJoin(documents, eq(documents.id, workflowRuns.workflowDocumentId))
    .where(
      and(
        eq(workflowRuns.status, 'running'),
        eq(workflowRuns.triggeredBy, auth.userId),
        eq(documents.companyId, auth.companyId),
        eq(documents.type, 'skill'),
      ),
    )
    .orderBy(desc(workflowRuns.startedAt))
    .limit(10);

  const count = runningRuns.length;
  const mostRecent = runningRuns[0];

  const href = mostRecent
    ? `/skills/${mostRecent.docId}/runs/${mostRecent.id}`
    : '/skills';

  if (count === 0) {
    // Subtle "no active runs" label — keeps the nav item stable.
    return (
      <Link
        href="/skills"
        className="quick-item text-muted-foreground"
        aria-label="Skills — no active runs"
      >
        <SkillsIcon />
        Skills
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="quick-item"
      aria-label={`Skills — ${count} run${count === 1 ? '' : 's'} active`}
    >
      <GaugeNeedle size="sm" />
      Skills
      <span
        className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--ember)] px-1 text-[10px] font-medium leading-none text-[var(--cream)]"
        aria-hidden="true"
      >
        {count}
      </span>
    </Link>
  );
}

function SkillsIcon() {
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

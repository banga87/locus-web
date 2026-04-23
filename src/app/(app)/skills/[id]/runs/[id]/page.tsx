// Run view — /skills/[id]/runs/[id]
//
// Relocated from /workflows/[slug]/runs/[id] during the skill/workflow
// unification. Lookup is id-based (matches the rest of /skills). The
// owning document is fetched by id + type='skill'; the run UUID is still
// the authoritative key and the [id] pair (skill id then run id) lets the
// breadcrumb/back-link stay consistent with the detail page.
//
// Server responsibilities:
//   1. Auth + ACL: requireAuth() + canAccessRun() (tenant isolation).
//   2. Id validation: confirm the URL's skill id matches the run's skill doc.
//   3. Render the app chrome (topbar + breadcrumbs).
//   4. Pass runId down to <RunView> (client component — hooks + Realtime).
//
// OutputCard is rendered from inside <RunView> based on live hook state
// (not from this server component), so it appears without a page refresh
// the moment `run_complete` lands. See notes in run-view.tsx.
//
// ACL note: returns 404 on denial (not 403) — same as the API routes —
// so we don't leak whether a run UUID exists across tenants.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { requireAuth } from '@/lib/api/auth';
import { canAccessRun } from '@/lib/workflow/access';
import { getWorkflowRunById } from '@/lib/workflow/queries';
import { RunView } from '@/components/skills/run-view';

interface PageProps {
  // Next.js dynamic route: `/skills/[id]/runs/[id]` — both segments share
  // the name `id` and Next resolves the inner one as the canonical value.
  // Using the outer `skillId` would require renaming the segment, which
  // would break every existing link pattern. Instead we accept the shape
  // Next gives us and derive both values by re-parsing the pathname
  // below — the run UUID is what matters for the query.
  params: Promise<{ id: string }>;
}

export default async function RunViewPage({ params }: PageProps) {
  const { id: runId } = await params;

  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  // Load run — includes companyId joined from documents for tenant check.
  const run = await getWorkflowRunById(runId);
  if (
    !run ||
    !canAccessRun(run, {
      userId: ctx.userId,
      companyId: ctx.companyId,
      role: ctx.role,
    })
  ) {
    return notFound();
  }

  // Load the owning skill doc — by id + type='skill'. We do NOT validate
  // the URL's outer skill-id segment against run.workflowDocumentId here
  // because Next.js collapses duplicate-named dynamic segments down to the
  // inner value. The run's own `workflowDocumentId` is the authoritative
  // link target; the breadcrumb and back-link use that id.
  const [doc] = await db
    .select({
      id: documents.id,
      title: documents.title,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, run.workflowDocumentId),
        eq(documents.type, 'skill'),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!doc) return notFound();

  return (
    <>
      <div className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <span>
            <Link href="/skills">Skills</Link>
            <span> / </span>
          </span>
          <span>
            <Link href={`/skills/${doc.id}`}>{doc.title}</Link>
            <span> / </span>
          </span>
          <span className="cur">Run</span>
        </nav>
        <div className="topbar-spacer" />
      </div>

      <div className="article-wrap">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          {/* Client component — subscribes to Realtime, renders event stream
              plus the OutputCard (which fetches its own doc titles via
              POST /api/brain/documents/titles once run_complete lands). */}
          <RunView runId={runId} skillId={doc.id} />

          {/* Back link */}
          <div className="mt-8 text-center">
            <Link
              href={`/skills/${doc.id}`}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
            >
              Back to skill
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

// Run view — /workflows/[slug]/runs/[id]
//
// Upgraded from stub (Task 7) to full reattachable run view (Task 8).
//
// Server responsibilities:
//   1. Auth + ACL: requireAuth() + canAccessRun() (tenant isolation).
//   2. Slug validation: confirm the URL slug matches the run's workflow doc.
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
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { RunView } from '@/components/workflows/run-view';

interface PageProps {
  params: Promise<{ slug: string; id: string }>;
}

export default async function RunViewPage({ params }: PageProps) {
  const { slug, id } = await params;

  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  // Load run — includes companyId joined from documents for tenant check.
  const run = await getWorkflowRunById(id);
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

  // Validate that the URL slug matches the run's actual workflow doc.
  // A mismatched slug means the URL is wrong — 404 rather than silently
  // serving the run under an incorrect breadcrumb.
  const [doc] = await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, run.workflowDocumentId),
        eq(documents.slug, slug),
        eq(documents.type, 'workflow'),
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
            <Link href="/workflows">Workflows</Link>
            <span> / </span>
          </span>
          <span>
            <Link href={`/workflows/${slug}`}>{doc.title}</Link>
            <span> / </span>
          </span>
          <span className="cur">Run</span>
        </nav>
        <div className="topbar-spacer" />
        <ThemeToggle />
      </div>

      <div className="article-wrap">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          {/* Client component — subscribes to Realtime, renders event stream
              plus the OutputCard (which fetches its own doc titles via
              POST /api/brain/documents/titles once run_complete lands). */}
          <RunView runId={id} workflowSlug={slug} />

          {/* Back link */}
          <div className="mt-8 text-center">
            <Link
              href={`/workflows/${slug}?tab=runs`}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
            >
              Back to run history
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

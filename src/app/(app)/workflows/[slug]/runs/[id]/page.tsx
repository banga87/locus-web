// Run view — /workflows/[slug]/runs/[id]
//
// Upgraded from stub (Task 7) to full reattachable run view (Task 8).
//
// Server responsibilities:
//   1. Auth + ACL: requireAuth() + canAccessRun() (tenant isolation).
//   2. Slug validation: confirm the URL slug matches the run's workflow doc.
//   3. Render the app chrome (topbar + breadcrumbs).
//   4. Pass runId down to <RunView> (client component — hooks + Realtime).
//   5. Render <OutputCard> below <RunView> in a Suspense boundary so the
//      server-side DB fetch for output doc titles doesn't block the initial
//      HTML. OutputCard renders null when outputDocumentIds is empty.
//
// ACL note: returns 404 on denial (not 403) — same as the API routes —
// so we don't leak whether a run UUID exists across tenants.

import { Suspense } from 'react';
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
import { OutputCard } from '@/components/workflows/output-card';

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

  const outputDocumentIds = run.outputDocumentIds ?? [];

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
          {/* Client component — subscribes to Realtime, renders event stream */}
          <RunView runId={id} workflowSlug={slug} />

          {/* Output card — server component in a Suspense boundary.
              Renders null when outputDocumentIds is empty (completed with
              no output, or run not yet complete).
              The <RunView> renders an #output anchor when complete+output
              present; the banner's "View output ↓" link targets that anchor.
              We pass the IDs from the server-side run row (the point-in-time
              snapshot); if the run hasn't completed yet, outputDocumentIds is
              [] and this renders nothing. The client can refresh the page
              after completion to see outputs, or follow the "View output ↓"
              link that appears in the banner once complete. */}
          {outputDocumentIds.length > 0 && (
            <div className="mt-6" id="output">
              <Suspense
                fallback={
                  <div className="h-20 animate-pulse rounded-lg bg-secondary/40" />
                }
              >
                <OutputCard outputDocumentIds={outputDocumentIds} />
              </Suspense>
            </div>
          )}

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

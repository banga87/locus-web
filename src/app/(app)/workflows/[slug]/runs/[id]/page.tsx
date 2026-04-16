// Run view stub — /workflows/[slug]/runs/[id]
//
// Task 8 builds the full reattachable run view. This stub exists so that
// RunButton's redirect to view_url has a valid target.
//
// ACL: delegates to Task 6's getWorkflowRunById + canAccessRun helpers so
// the stub enforces the full rule set (tenant + triggered-by + owner/admin)
// rather than the lighter tenant-only check it originally shipped with.
// This also puts Task 8 on the right foundation.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { requireAuth } from '@/lib/api/auth';
import { canAccessRun } from '@/lib/workflow/access';
import { getWorkflowRunById } from '@/lib/workflow/queries';
import { ThemeToggle } from '@/components/shell/theme-toggle';

interface PageProps {
  params: Promise<{ slug: string; id: string }>;
}

export default async function RunViewStubPage({ params }: PageProps) {
  const { slug, id } = await params;

  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  // getWorkflowRunById joins documents to surface the run's companyId,
  // which canAccessRun uses for tenant isolation. Returning 404 (not 403)
  // mirrors the API routes' policy — we don't leak whether a run UUID
  // exists across tenants.
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

  // Fetch the workflow doc for the breadcrumb title/slug. Tenant is already
  // confirmed via canAccessRun, but we still filter by slug + brain-adjacent
  // criteria (type=workflow, not deleted) to make sure the URL's slug param
  // matches the run's actual workflow doc — a mismatched slug is a 404.
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
        <div className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
          <p
            className="text-2xl text-ink"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            Run view coming in Task 8
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Run ID:{' '}
            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
              {run.id}
            </code>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Status:{' '}
            <span className="font-medium text-ink">{run.status}</span>
          </p>
          <div className="mt-8">
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

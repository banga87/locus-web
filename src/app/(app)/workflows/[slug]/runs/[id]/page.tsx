// Run view stub — /workflows/[slug]/runs/[id]
//
// Task 8 builds the full reattachable run view. This stub exists so that
// RunButton's redirect to view_url has a valid target.
//
// We do a minimal tenant-isolation check (run belongs to this company)
// so the stub doesn't leak run IDs across tenants.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { ThemeToggle } from '@/components/shell/theme-toggle';

interface PageProps {
  params: Promise<{ slug: string; id: string }>;
}

export default async function RunViewStubPage({ params }: PageProps) {
  const { slug, id } = await params;

  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const brain = await getBrainForCompany(ctx.companyId);

  // Load the workflow doc to verify it exists in this brain.
  const [doc] = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.slug, slug),
        eq(documents.brainId, brain.id),
        eq(documents.type, 'workflow'),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  if (!doc) return notFound();

  // Load the run row and verify it belongs to the workflow doc.
  const [run] = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.id, id),
        eq(workflowRuns.workflowDocumentId, doc.id),
      ),
    )
    .limit(1);

  if (!run) return notFound();

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
            Run ID: <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">{run.id}</code>
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

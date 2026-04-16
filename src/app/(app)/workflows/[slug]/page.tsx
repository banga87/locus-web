// Workflow detail page — /workflows/[slug]
//
// Two tabs:
//   Definition — the Tiptap editor for this workflow document.
//   Runs       — RunHistoryTable listing past runs.
//
// The [slug] param resolves to the document's slug column (unique within
// a brain). We do NOT reuse the brain editor edit page directly because
// the sidebar here shows WorkflowFrontmatterFields rather than the generic
// FrontmatterSidebar, and the topbar crumbs belong to /workflows not /brain.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents, users } from '@/db/schema';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { RunButton } from '@/components/workflows/run-button';
import { RunHistoryTable } from '@/components/workflows/run-history-table';
import { WorkflowFrontmatterFields } from '@/components/workflows/workflow-frontmatter-fields';
import { WorkflowDetailTabs } from '@/components/workflows/workflow-detail-tabs';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function WorkflowDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const { tab } = await searchParams;
  const activeTab = tab === 'runs' ? 'runs' : 'definition';

  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const brain = await getBrainForCompany(ctx.companyId);

  const [row] = await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      content: documents.content,
      status: documents.status,
      confidenceLevel: documents.confidenceLevel,
      ownerId: documents.ownerId,
      metadata: documents.metadata,
      type: documents.type,
    })
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

  if (!row) return notFound();

  // Owner list for the editor sidebar (only the caller for now — matches
  // the brain editor pattern).
  const [self] = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .limit(1);

  const owners = self
    ? [{ id: self.id, label: self.fullName ?? self.email }]
    : [];

  // Run history
  const runs = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
      summary: workflowRuns.summary,
      totalCostUsd: workflowRuns.totalCostUsd,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowDocumentId, row.id))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(50);

  // Extract workflow frontmatter from metadata jsonb.
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const frontmatter = {
    output: typeof meta['output'] === 'string' ? meta['output'] : 'document',
    output_category:
      typeof meta['output_category'] === 'string'
        ? meta['output_category']
        : null,
    requires_mcps: Array.isArray(meta['requires_mcps'])
      ? (meta['requires_mcps'] as string[])
      : [],
    schedule:
      typeof meta['schedule'] === 'string' ? meta['schedule'] : null,
  };

  const canEdit = ['owner', 'admin', 'editor'].includes(ctx.role);

  const typedRuns = runs.map((r) => ({
    ...r,
    status: r.status as
      | 'running'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'queued',
    totalCostUsd: r.totalCostUsd ?? null,
  }));

  return (
    <>
      <div className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <span>
            <Link href="/workflows">Workflows</Link>
            <span> / </span>
          </span>
          <span className="cur">{row.title}</span>
        </nav>
        <div className="topbar-spacer" />
        <RunButton workflowDocumentId={row.id} />
        <ThemeToggle />
      </div>

      <div className="article-wrap">
        <WorkflowDetailTabs
          document={{
            id: row.id,
            title: row.title,
            content: row.content,
            status: row.status,
            confidenceLevel: row.confidenceLevel,
            ownerId: row.ownerId ?? null,
          }}
          owners={owners}
          runs={typedRuns}
          workflowSlug={row.slug}
          frontmatter={frontmatter}
          canEdit={canEdit}
          activeTab={activeTab}
        />
      </div>
    </>
  );
}

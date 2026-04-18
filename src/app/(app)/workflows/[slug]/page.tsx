// Workflow detail page — /workflows/[slug]
//
// Two tabs:
//   Definition — the Tiptap editor for this workflow document.
//   Runs       — RunHistoryTable listing past runs.
//
// The [slug] param resolves to the document's slug column (unique within
// a brain). We do NOT reuse the brain editor edit page directly because
// the sidebar renders the schema-aware FrontmatterPanel rather than the
// generic FrontmatterSidebar, and the topbar crumbs belong to /workflows
// not /brain.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { RunButton } from '@/components/workflows/run-button';
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

  const canEdit = ['owner', 'admin', 'editor'].includes(ctx.role);
  // Viewers cannot trigger workflows (matches the trigger route's 403 gate).
  // Hide the button rather than rendering it and having the API slap them
  // with a misleading error — same set as canEdit at present.
  const canRun = ['owner', 'admin', 'editor'].includes(ctx.role);

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
        {canRun && <RunButton workflowDocumentId={row.id} />}
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
          runs={typedRuns}
          workflowSlug={row.slug}
          docType={row.type}
          canEdit={canEdit}
          activeTab={activeTab}
        />
      </div>
    </>
  );
}

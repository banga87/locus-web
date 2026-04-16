// Workflows index page — lists all `type: workflow` documents for the
// current brain. Includes a "New workflow" button and a "Describe a new
// workflow" shortcut to the Platform Agent chat.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { WorkflowList } from '@/components/workflows/workflow-list';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';

export default async function WorkflowsIndexPage() {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const brain = await getBrainForCompany(ctx.companyId);

  // Fetch all workflow-type documents for this brain.
  const wfDocs = await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      metadata: documents.metadata,
    })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, brain.id),
        eq(documents.type, 'workflow'),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.updatedAt));

  // For each workflow doc, find the most recent run (if any).
  // One query per doc is fine at MVP scale. If this becomes a hot path,
  // replace with a single DISTINCT ON (workflow_document_id) query.
  const workflows = await Promise.all(
    wfDocs.map(async (doc) => {
      const [lastRun] = await db
        .select({
          id: workflowRuns.id,
          status: workflowRuns.status,
          startedAt: workflowRuns.startedAt,
        })
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowDocumentId, doc.id))
        .orderBy(desc(workflowRuns.startedAt))
        .limit(1);

      const meta = (doc.metadata ?? {}) as Record<string, unknown>;

      return {
        id: doc.id,
        slug: doc.slug,
        title: doc.title,
        frontmatter: {
          output: typeof meta['output'] === 'string' ? meta['output'] : undefined,
          output_category:
            typeof meta['output_category'] === 'string'
              ? meta['output_category']
              : null,
          requires_mcps: Array.isArray(meta['requires_mcps'])
            ? (meta['requires_mcps'] as string[])
            : [],
        },
        lastRun: lastRun
          ? {
              id: lastRun.id,
              status: lastRun.status as
                | 'running'
                | 'completed'
                | 'failed'
                | 'cancelled'
                | 'queued',
              startedAt: lastRun.startedAt,
            }
          : undefined,
      };
    }),
  );

  // "Describe a new workflow" seeded prompt.
  // The chat route doesn't currently support URL-seeded prompts — this links
  // to /chat and puts a hint in the query string. The chat UI can ignore it;
  // the fallback is a plain link. If chat prompt-seeding is added later,
  // update the query param name here.
  const seededChatUrl = `/chat?prompt=${encodeURIComponent("I\u2019d like to create a workflow that\u2026")}`;

  const canCreate = ['owner', 'admin', 'editor'].includes(ctx.role);

  return (
    <>
      <div className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <span className="cur">Workflows</span>
        </nav>
        <div className="topbar-spacer" />
        {canCreate && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href={seededChatUrl}>Describe a new workflow</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/workflows/new">New workflow</Link>
            </Button>
          </div>
        )}
        <ThemeToggle />
      </div>

      <div className="article-wrap">
        <div className="mx-auto w-full max-w-5xl px-6 py-10">
          <header className="mb-8">
            <p
              className="text-3xl text-ink"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
            >
              Workflows
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Agent-run automations for your brain.
            </p>
          </header>

          <WorkflowList workflows={workflows} />
        </div>
      </div>
    </>
  );
}

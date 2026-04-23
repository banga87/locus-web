// /skills — Skills index page.
//
// Lists all skill root documents for the current workspace. Following the
// skill/workflow unification (Task 6), this page also surfaces each
// skill's triggerable status and latest run state inline.
//
// A skill is "triggerable" if its `metadata.trigger` block is present.
// Triggerable cards show a subtle marker + a "last run" status line.
// Non-triggerable (on-demand) cards are unchanged.
//
// Topbar filter `?filter=all|triggerable|ondemand` narrows the list.
// The default ('all') shows every skill. Filtering is server-side so the
// list shrinks without a round-trip on hydration.

import { notFound } from 'next/navigation';
import { and, count, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import {
  extractYamlFrontmatter,
  parseOrigin,
  parseSkillsFromAgentContent,
} from '@/lib/skills/frontmatter';
import { SkillCard } from './_components/skill-card';
import { NewSkillDropdown } from './_components/new-skill-dropdown';
import { InstallButton } from './_components/install-button';
import { SkillFilterTabs } from './_components/skill-filter-tabs';

// ─── Types ─────────────────────────────────────────────────────────────────

type FilterValue = 'all' | 'triggerable' | 'ondemand';

function parseFilter(raw: string | string[] | undefined): FilterValue {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'triggerable' || v === 'ondemand') return v;
  return 'all';
}

interface PageProps {
  searchParams: Promise<{ filter?: string | string[] }>;
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default async function SkillsIndexPage({ searchParams }: PageProps) {
  const { filter } = await searchParams;
  const activeFilter = parseFilter(filter);

  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const brain = await getBrainForCompany(ctx.companyId);

  // 1. Fetch skill root documents — `metadata` now included so we can
  //    detect `trigger:` presence per skill.
  const skillDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      metadata: documents.metadata,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, brain.id),
        eq(documents.type, 'skill'),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.updatedAt));

  // 2. Count live skill-resource children in one GROUP BY query.
  const resourceCountRows = await db
    .select({
      parentSkillId: documents.parentSkillId,
      total: count(),
    })
    .from(documents)
    .where(
      and(
        eq(documents.type, 'skill-resource'),
        isNull(documents.deletedAt),
      ),
    )
    .groupBy(documents.parentSkillId);

  const resourceCountMap = new Map<string, number>(
    resourceCountRows
      .filter((r): r is { parentSkillId: string; total: number } => r.parentSkillId !== null)
      .map(({ parentSkillId, total }) => [parentSkillId, total]),
  );

  // 3. Agent-definition skill usage map: skill-id → count.
  const agentDocs = await db
    .select({ id: documents.id, content: documents.content })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, brain.id),
        eq(documents.type, 'agent-definition'),
        isNull(documents.deletedAt),
      ),
    );

  const agentCountMap: Record<string, number> = {};
  for (const agent of agentDocs) {
    const skillIds = parseSkillsFromAgentContent(agent.content);
    for (const skillId of skillIds) {
      agentCountMap[skillId] = (agentCountMap[skillId] ?? 0) + 1;
    }
  }

  // 4. Identify triggerable skills and fetch the latest run per triggerable
  //    skill. One-query-per-skill is fine at MVP scale (mirrors the old
  //    /workflows page pattern); promote to a single DISTINCT ON query if
  //    this becomes a hot path.
  const isTriggerableDoc = (meta: unknown): boolean => {
    if (!meta || typeof meta !== 'object') return false;
    const trigger = (meta as Record<string, unknown>)['trigger'];
    return trigger !== undefined && trigger !== null;
  };

  const triggerableIds = skillDocs
    .filter((d) => isTriggerableDoc(d.metadata))
    .map((d) => d.id);

  const latestRunBySkillId = new Map<
    string,
    {
      id: string;
      status: 'running' | 'completed' | 'failed' | 'cancelled' | 'queued';
      startedAt: Date;
    }
  >();

  if (triggerableIds.length > 0) {
    await Promise.all(
      triggerableIds.map(async (skillId) => {
        const [lastRun] = await db
          .select({
            id: workflowRuns.id,
            status: workflowRuns.status,
            startedAt: workflowRuns.startedAt,
          })
          .from(workflowRuns)
          .where(eq(workflowRuns.workflowDocumentId, skillId))
          .orderBy(desc(workflowRuns.startedAt))
          .limit(1);
        if (lastRun) {
          latestRunBySkillId.set(skillId, {
            id: lastRun.id,
            status: lastRun.status as
              | 'running'
              | 'completed'
              | 'failed'
              | 'cancelled'
              | 'queued',
            startedAt: lastRun.startedAt,
          });
        }
      }),
    );
  }

  // 5. Shape into card props.
  const allSkills = skillDocs.map((doc) => {
    const fm = extractYamlFrontmatter(doc.content);
    const description =
      typeof fm['description'] === 'string' ? fm['description'] : null;
    const isTriggerable = isTriggerableDoc(doc.metadata);
    return {
      id: doc.id,
      title: doc.title,
      description,
      origin: parseOrigin(doc.content),
      resourceCount: resourceCountMap.get(doc.id) ?? 0,
      agentCount: agentCountMap[doc.id] ?? 0,
      updatedAt: doc.updatedAt,
      isTriggerable,
      lastRun: isTriggerable ? latestRunBySkillId.get(doc.id) ?? null : null,
    };
  });

  // 6. Filter per `?filter=...`.
  const skills = allSkills.filter((s) => {
    if (activeFilter === 'triggerable') return s.isTriggerable;
    if (activeFilter === 'ondemand') return !s.isTriggerable;
    return true;
  });

  const canCreate = ['owner', 'admin', 'editor'].includes(ctx.role);

  // Counts per filter value — rendered inside the filter tabs so the user
  // can see at a glance how many skills are in each bucket without flipping
  // filters.
  const counts = {
    all: allSkills.length,
    triggerable: allSkills.filter((s) => s.isTriggerable).length,
    ondemand: allSkills.filter((s) => !s.isTriggerable).length,
  };

  return (
    <>
      <div className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          <span className="cur">Skills</span>
        </nav>
        <div className="topbar-spacer" />
        {canCreate && (
          <div className="flex items-center gap-2">
            <InstallButton />
            <NewSkillDropdown />
          </div>
        )}
      </div>

      <div className="article-wrap">
        <div className="mx-auto w-full max-w-5xl px-6 py-10">
          <header className="mb-6">
            <p
              className="text-3xl text-ink"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
            >
              Skills
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Reusable instruction sets and reference material for your agents.
              Some skills can be triggered to run on demand.
            </p>
          </header>

          <SkillFilterTabs active={activeFilter} counts={counts} />

          {skills.length === 0 ? (
            <div className="rounded-lg border border-border bg-secondary px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {activeFilter === 'triggerable'
                  ? 'No triggerable skills yet. Add a `trigger:` block in a skill\u2019s frontmatter to make it runnable.'
                  : activeFilter === 'ondemand'
                    ? 'No on-demand skills yet.'
                    : 'No skills yet. Install one from GitHub or write your own.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {skills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  id={skill.id}
                  title={skill.title}
                  description={skill.description}
                  origin={skill.origin}
                  resourceCount={skill.resourceCount}
                  agentCount={skill.agentCount}
                  updatedAt={skill.updatedAt}
                  isTriggerable={skill.isTriggerable}
                  lastRun={skill.lastRun}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

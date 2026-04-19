// /skills — Skills index page.
//
// Lists all skill root documents for the current workspace, grouped by
// origin (installed from GitHub, authored, forked). The topbar includes
// a NewSkillDropdown and an inert "Install" button (Task 23 will wire it).

import { notFound } from 'next/navigation';
import { and, count, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
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
import type { SkillOrigin } from '@/lib/skills/types';

// ─── Page ──────────────────────────────────────────────────────────────────

export default async function SkillsIndexPage() {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const brain = await getBrainForCompany(ctx.companyId);

  // 1. Fetch skill root documents.
  const skillDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
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

  // 4. Shape into card props.
  const skills = skillDocs.map((doc) => {
    const fm = extractYamlFrontmatter(doc.content);
    const description =
      typeof fm['description'] === 'string' ? fm['description'] : null;
    return {
      id: doc.id,
      title: doc.title,
      description,
      origin: parseOrigin(doc.content),
      resourceCount: resourceCountMap.get(doc.id) ?? 0,
      agentCount: agentCountMap[doc.id] ?? 0,
      updatedAt: doc.updatedAt,
    };
  });

  const canCreate = ['owner', 'admin', 'editor'].includes(ctx.role);

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
          <header className="mb-8">
            <p
              className="text-3xl text-ink"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
            >
              Skills
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Reusable instruction sets and reference material for your agents.
            </p>
          </header>

          {skills.length === 0 ? (
            <div className="rounded-lg border border-border bg-secondary px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No skills yet. Install one from GitHub or write your own.
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
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

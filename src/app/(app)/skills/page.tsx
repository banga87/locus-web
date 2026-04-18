// /skills — Skills index page.
//
// Lists all skill root documents for the current workspace, grouped by
// origin (installed from GitHub, authored, forked). The topbar includes
// a NewSkillDropdown and an inert "Install" button (Task 23 will wire it).

import { notFound } from 'next/navigation';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { getBrainForCompany } from '@/lib/brain/queries';
import { Button } from '@/components/ui/button';
import { SkillCard } from './_components/skill-card';
import { NewSkillDropdown } from './_components/new-skill-dropdown';
import type { SkillOrigin } from './_components/skill-card';

// ─── Frontmatter helpers (duplicated from API route for Server Component) ──

function extractYamlFrontmatter(content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match || !match[1]) return {};
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed frontmatter.
  }
  return {};
}

function parseOrigin(content: string): SkillOrigin {
  const fm = extractYamlFrontmatter(content);
  const source = fm['source'];

  if (source && typeof source === 'object') {
    const src = source as Record<string, unknown>;

    if (src['forked_from'] && typeof src['forked_from'] === 'string') {
      return { kind: 'forked', from: src['forked_from'] };
    }

    const github = src['github'];
    if (github && typeof github === 'object') {
      const gh = github as Record<string, unknown>;
      const owner = typeof gh['owner'] === 'string' ? gh['owner'] : '';
      const repo = typeof gh['repo'] === 'string' ? gh['repo'] : '';
      const skill = typeof gh['skill'] === 'string' ? gh['skill'] : null;
      if (owner && repo) {
        return { kind: 'installed', owner, repo, skill };
      }
    }
  }

  return { kind: 'authored' };
}

function parseSkillsFromAgentContent(content: string): string[] {
  const fm = extractYamlFrontmatter(content);
  const skills = fm['skills'];
  if (Array.isArray(skills)) {
    return skills.filter((s): s is string => typeof s === 'string');
  }
  return [];
}

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

  // 2. Resource counts per skill (one query each — small N at MVP scale).
  const resourceCounts = await Promise.all(
    skillDocs.map(async (skill) => {
      const [row] = await db
        .select({ total: count() })
        .from(documents)
        .where(
          and(
            eq(documents.parentSkillId, skill.id),
            eq(documents.type, 'skill-resource'),
            isNull(documents.deletedAt),
          ),
        );
      return { skillId: skill.id, total: row?.total ?? 0 };
    }),
  );
  const resourceCountMap = Object.fromEntries(
    resourceCounts.map(({ skillId, total }) => [skillId, total]),
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
      resourceCount: resourceCountMap[doc.id] ?? 0,
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
            {/* Install button — inert placeholder; Task 23 wires this. */}
            <Button variant="outline" size="sm" data-test="install-button" disabled>
              Install from GitHub
            </Button>
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

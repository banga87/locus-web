// GET /api/skills
//
// Lists all skill root documents for the authenticated user's company, with:
//   - origin badge data (parsed from YAML frontmatter `source` block)
//   - resource count (live children with type='skill-resource')
//   - agent count (agent-definitions whose frontmatter skills: array contains this id)
//
// Sorted: most recently updated first.
//
// POST is deferred to Task 26.

import { and, count, desc, eq, isNull } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';

// ─── Origin types ──────────────────────────────────────────────────────────

export type SkillOrigin =
  | { kind: 'installed'; owner: string; repo: string; skill: string | null }
  | { kind: 'forked'; from: string }
  | { kind: 'authored' };

// ─── Frontmatter helpers ───────────────────────────────────────────────────

function extractYamlFrontmatter(content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match || !match[1]) return {};
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed frontmatter — treat as no frontmatter.
  }
  return {};
}

function parseOrigin(content: string): SkillOrigin {
  const fm = extractYamlFrontmatter(content);
  const source = fm['source'];

  if (source && typeof source === 'object') {
    const src = source as Record<string, unknown>;

    // Forked origin check first (Task 24 will write this field).
    if (src['forked_from'] && typeof src['forked_from'] === 'string') {
      return { kind: 'forked', from: src['forked_from'] };
    }

    // Installed from GitHub.
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

// ─── Route handler ─────────────────────────────────────────────────────────

export const GET = () =>
  withAuth(async (ctx) => {
    const companyIdOrResponse = requireCompany(ctx);
    if (companyIdOrResponse instanceof Response) return companyIdOrResponse;
    const companyId = companyIdOrResponse;

    const brain = await getBrainForCompany(companyId);

    // 1. Fetch all skill root documents.
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

    // 2. For each skill, count live skill-resource children.
    //    Small N at MVP — one query per skill is acceptable.
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

    // 3. Fetch all agent-definitions and build a skill-id → agent-count map.
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

    // 4. Assemble the response payload.
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

    return success({ skills });
  });

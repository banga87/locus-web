// GET /api/skills
//
// Lists all skill root documents for the authenticated user's company, with:
//   - origin badge data (parsed from YAML frontmatter `source` block)
//   - resource count (live children with type='skill-resource')
//   - agent count (agent-definitions whose frontmatter skills: array contains this id)
//
// Sorted: most recently updated first.
//
// POST /api/skills (Task 26)
//
// Quick-form create (Path A). Body: { name, description, instructions }.
// Validates all three non-empty, name unique within company (slug uniqueness),
// then writes a root-only skill via writeSkillTree with resources: [].
// Returns 201 { skill_id: string } on success.

import { z } from 'zod';
import { and, count, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { success, created, error } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import {
  extractYamlFrontmatter,
  parseOrigin,
  parseSkillsFromAgentContent,
} from '@/lib/skills/frontmatter';
import { writeSkillTree } from '@/lib/skills/write-skill-tree';

export type { SkillOrigin } from '@/lib/skills/types';

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
        resourceCount: resourceCountMap.get(doc.id) ?? 0,
        agentCount: agentCountMap[doc.id] ?? 0,
        updatedAt: doc.updatedAt,
      };
    });

    return success({ skills });
  });

// ─── POST /api/skills ───────────────────────────────────────────────────────

const createSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(1000),
    instructions: z.string().min(1),
  })
  .strict();

export const POST = (req: Request) =>
  withAuth(async (ctx) => {
    const companyIdOrResponse = requireCompany(ctx);
    if (companyIdOrResponse instanceof Response) return companyIdOrResponse;
    const companyId = companyIdOrResponse;

    // 1. Parse + validate body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_input', 'Request body must be valid JSON.', 400);
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_input', parsed.error.message, 400);
    }

    const { name, description, instructions } = parsed.data;

    // 2. Resolve brain.
    const brain = await getBrainForCompany(companyId);

    // 3. Write skill tree (root only, no resource children).
    let rootId: string;
    try {
      const result = await writeSkillTree({
        companyId,
        brainId: brain.id,
        name,
        description,
        skillMdBody: instructions,
        resources: [],
        // source: undefined — authored skill, no github block
      });
      rootId = result.rootId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg.includes('produces an empty slug')) {
        return error('invalid_input', msg, 400);
      }

      // Postgres 23505 unique-constraint violation on (brain_id, slug) partial index.
      if (msg.includes('slug_taken') || msg.includes('23505')) {
        return error(
          'slug_taken',
          `A skill named '${name}' already exists in this workspace.`,
          409,
        );
      }

      return error('internal_error', 'Failed to create skill.', 500);
    }

    return created({ skill_id: rootId });
  });

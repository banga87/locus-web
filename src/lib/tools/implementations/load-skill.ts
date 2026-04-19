// load_skill — return a skill's SKILL.md body + the list of nested
// resource relative paths. Agent-allowlisted by `ToolContext.agentSkillIds`.
//
// Implementation notes:
//   - The "SKILL.md body" we return is the root row's `content` with the
//     YAML frontmatter block stripped (agents don't need frontmatter to act
//     on the instructions, and dropping it saves tokens).
//   - The `files` list comes from a single indexed query:
//       WHERE parent_skill_id = :id
//         AND type = 'skill-resource'
//         AND deleted_at IS NULL
//     backed by `documents_skill_resource_path`.

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface Input { skill_id: string }
interface Output { body: string; files: string[] }

export const loadSkillTool: LocusTool<Input, Output> = {
  name: 'load_skill',
  description:
    'Load a skill you saw in <available-skills>. Returns the skill ' +
    'instructions and a list of nested files you can read with ' +
    'read_skill_file(skill_id, path).',
  inputSchema: {
    type: 'object',
    properties: { skill_id: { type: 'string', format: 'uuid' } },
    required: ['skill_id'],
    additionalProperties: false,
  },
  action: 'read' as const,
  resourceType: 'document' as const,
  isReadOnly() { return true; },

  async call(input, context): Promise<ToolResult<Output>> {
    const allow = context.agentSkillIds ?? [];
    if (!allow.includes(input.skill_id)) {
      return unavailable(input.skill_id);
    }

    const [root] = await db
      .select({
        id: documents.id,
        type: documents.type,
        content: documents.content,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, input.skill_id),
          eq(documents.companyId, context.companyId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!root) return notFound(input.skill_id);
    if (root.type !== 'skill') return notASkill(input.skill_id);

    const children = await db
      .select({ relativePath: documents.relativePath })
      .from(documents)
      .where(
        and(
          eq(documents.parentSkillId, root.id),
          eq(documents.type, 'skill-resource'),
          isNull(documents.deletedAt),
        ),
      );

    const body = stripFrontmatter(root.content);
    const files = children
      .map((c) => c.relativePath!)
      .sort();

    return {
      success: true,
      data: { body, files },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: [root.id],
        details: { eventType: 'skill.load', skill_id: root.id },
      },
    };
  },
};

function stripFrontmatter(md: string): string {
  const m = md.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return m ? m[1].replace(/^\n+/, '') : md;
}

function unavailable(id: string): ToolResult<Output> {
  return fail('unavailable',
    `Skill ${id} is not available to this agent. Only skills in the ` +
    `<available-skills> block can be loaded.`,
    id);
}
function notFound(id: string): ToolResult<Output> {
  return fail('not_found', `No skill with id ${id}.`, id);
}
function notASkill(id: string): ToolResult<Output> {
  return fail('not_a_skill',
    `Document ${id} exists but is not a skill.`, id);
}
function fail(code: string, message: string, id: string): ToolResult<Output> {
  return {
    success: false,
    error: { code, message, retryable: false },
    metadata: {
      responseTokens: 0, executionMs: 0,
      documentsAccessed: [],
      details: { eventType: 'skill.load', skill_id: id, found: false },
    },
  };
}

// read_skill_file — read a nested file inside a skill. Agent-allowlisted
// by ToolContext.agentSkillIds. On path miss, returns suggestions sourced
// from the same indexed query as load_skill's files list.

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface Input { skill_id: string; relative_path: string }
interface Output { content: string }

export const readSkillFileTool: LocusTool<Input, Output> = {
  name: 'read_skill_file',
  description:
    'Read a nested file inside a skill you previously loaded. Use the ' +
    '(skill_id, relative_path) you learned from load_skill.',
  inputSchema: {
    type: 'object',
    properties: {
      skill_id: { type: 'string', format: 'uuid' },
      relative_path: { type: 'string', minLength: 1 },
    },
    required: ['skill_id', 'relative_path'],
    additionalProperties: false,
  },
  action: 'read' as const,
  resourceType: 'document' as const,
  isReadOnly() { return true; },

  async call(input, context): Promise<ToolResult<Output>> {
    const allow = context.agentSkillIds ?? [];
    if (!allow.includes(input.skill_id)) {
      return fail('unavailable',
        `Skill ${input.skill_id} is not available to this agent.`);
    }

    const [row] = await db
      .select({ content: documents.content })
      .from(documents)
      .where(
        and(
          eq(documents.parentSkillId, input.skill_id),
          eq(documents.relativePath, input.relative_path),
          eq(documents.type, 'skill-resource'),
          eq(documents.companyId, context.companyId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (row) {
      return {
        success: true,
        data: { content: row.content },
        metadata: {
          responseTokens: 0, executionMs: 0,
          documentsAccessed: [],
          details: {
            eventType: 'skill.read_file',
            skill_id: input.skill_id,
            relative_path: input.relative_path,
          },
        },
      };
    }

    // Collect sibling paths for the suggestion list.
    const siblings = await db
      .select({ relativePath: documents.relativePath })
      .from(documents)
      .where(
        and(
          eq(documents.parentSkillId, input.skill_id),
          eq(documents.type, 'skill-resource'),
          isNull(documents.deletedAt),
        ),
      );

    return {
      success: false,
      error: {
        code: 'path_not_found',
        message:
          `No file at '${input.relative_path}' inside skill ` +
          `${input.skill_id}.`,
        suggestions: siblings.map((s) => s.relativePath!).sort(),
        hint: 'Pick one of the suggested paths, or call load_skill again to refresh the list.',
        retryable: false,
      },
      metadata: {
        responseTokens: 0, executionMs: 0,
        documentsAccessed: [],
        details: {
          eventType: 'skill.read_file',
          skill_id: input.skill_id,
          relative_path: input.relative_path,
          found: false,
        },
      },
    };
  },
};

function fail(code: string, message: string): ToolResult<Output> {
  return {
    success: false,
    error: { code, message, retryable: false },
    metadata: {
      responseTokens: 0, executionMs: 0,
      documentsAccessed: [],
      details: { eventType: 'skill.read_file', found: false },
    },
  };
}

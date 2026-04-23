// userDefinedAgents — materialise user-authored `agent-definition` docs
// from the `documents` table into `BuiltInAgentDefinition` entries that
// the subagent dispatcher can call just like built-in agents.
//
// Design notes:
//   - Uses `js-yaml` to parse the YAML frontmatter (arrays like
//     `tool_allowlist` cannot be handled by the scalar-only
//     `parseFrontmatterRaw` helper in `@/lib/brain/save`).
//   - No caching. Every call hits the DB. Add a per-turn memoisation
//     wrapper in the caller if the hot path becomes an issue.
//   - Company isolation is enforced by the `company_id = $1` WHERE
//     clause; soft-deleted rows are excluded via `deleted_at IS NULL`.
//   - The `agentType` for each user-defined agent equals the doc's slug
//     (the same string the user specifies in the Agent tool call).
//   - `model` is normalised from the wizard's short form (`claude-sonnet-4-6`)
//     to an `ApprovedModelId` (`anthropic/claude-sonnet-4.6`). Unknown
//     values fall back to `'inherit'`.

import { and, eq, isNull } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { isApprovedModelId } from '@/lib/models/approved-models';
import type { ApprovedModelId } from '@/lib/models/approved-models';

import type { BuiltInAgentDefinition } from './types';

// Map the wizard's short-form model IDs (hyphens, no provider prefix) to
// ApprovedModelId (dot notation, provider prefix). Keep in sync with
// `ALLOWED_MODELS` in `src/lib/agents/wizard-schema.ts`.
const WIZARD_MODEL_MAP: Record<string, ApprovedModelId> = {
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6',
  'claude-opus-4-6': 'anthropic/claude-opus-4.7',
  'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4.5',
};

function resolveModel(raw: unknown): ApprovedModelId | 'inherit' {
  if (typeof raw !== 'string' || !raw) return 'inherit';
  // Already a fully-qualified ApprovedModelId?
  if (isApprovedModelId(raw)) return raw;
  // Wizard short-form?
  const mapped = WIZARD_MODEL_MAP[raw];
  if (mapped) return mapped;
  return 'inherit';
}

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  if (!v.every((x) => typeof x === 'string')) return undefined;
  return v as string[];
}

function parseFrontmatterYaml(content: string): Record<string, unknown> {
  if (!content.startsWith('---\n')) return {};
  const closeIdx = content.indexOf('\n---\n', 4);
  if (closeIdx === -1) return {};
  const block = content.slice(4, closeIdx);
  const parsed = yaml.load(block);
  if (!parsed || typeof parsed !== 'object') return {};
  return parsed as Record<string, unknown>;
}

function buildSystemPromptForUserAgent(params: {
  slug: string;
  systemPromptSnippet: string | undefined;
  capabilities: string[] | undefined;
  skills: string[] | undefined;
}): string {
  const lines: string[] = [];

  lines.push(`You are the ${params.slug} agent.`);
  lines.push('');

  if (params.systemPromptSnippet) {
    lines.push('=== PERSONA & INSTRUCTIONS ===');
    lines.push(params.systemPromptSnippet);
    lines.push('');
  }

  if (params.capabilities && params.capabilities.length > 0) {
    lines.push(`=== CAPABILITIES ===`);
    lines.push(`You have access to: ${params.capabilities.join(', ')}`);
    lines.push('');
  }

  if (params.skills && params.skills.length > 0) {
    lines.push(`=== SKILLS ===`);
    lines.push(
      `The following skill IDs are available to you: ${params.skills.join(', ')}`,
    );
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Query the `documents` table for `agent-definition` rows belonging to
 * the given company and materialise each into a `BuiltInAgentDefinition`
 * that the subagent dispatcher can call.
 *
 * Soft-deleted rows are excluded. No caching — the caller memoises if
 * needed.
 */
export async function listUserDefinedAgents(
  companyId: string,
): Promise<BuiltInAgentDefinition[]> {
  const rows = await db
    .select({
      slug: documents.slug,
      content: documents.content,
    })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.type, 'agent-definition'),
        isNull(documents.deletedAt),
      ),
    );

  return rows.flatMap((row) => {
    let fm: Record<string, unknown>;
    try {
      fm = parseFrontmatterYaml(row.content);
    } catch (err) {
      console.warn(
        '[subagent/userDefinedAgents] skipping agent-definition doc',
        row.slug ?? '(no slug)',
        '— malformed frontmatter',
        err,
      );
      return [];
    }

    const slug = row.slug;
    if (!slug) return [];

    const description =
      typeof fm.description === 'string' && fm.description.trim()
        ? fm.description.trim()
        : undefined;
    const whenToUse = description ?? `Run the ${slug} agent.`;

    const model = resolveModel(fm.model);

    const toolAllowlist = toStringArray(fm.tool_allowlist);

    const systemPromptSnippet =
      typeof fm.system_prompt_snippet === 'string'
        ? fm.system_prompt_snippet
        : undefined;

    const capabilities = toStringArray(fm.capabilities);
    const skills = toStringArray(fm.skills);

    const def: BuiltInAgentDefinition = {
      agentType: slug,
      whenToUse,
      model,
      ...(toolAllowlist !== undefined ? { tools: toolAllowlist } : {}),
      omitBrainContext: false,
      getSystemPrompt: () =>
        buildSystemPromptForUserAgent({
          slug,
          systemPromptSnippet,
          capabilities,
          skills,
        }),
    };

    return [def];
  });
}

// Agent config resolver — translates a slug to an AgentRuntimeConfig.
//
// The single source-of-truth for the platform-agent sentinel slug lives
// here so callers (workflow runner, route handlers) import the constant
// rather than hard-coding the string.
//
// Design decision: Option A — duplicate the frontmatter helpers from
// `src/lib/context/repos.ts` inline. The helpers are small (~30 lines),
// and coupling this module to `repos.ts` internals would be worse than
// the duplication. `repos.ts` is a ScaffoldingRepo factory; pulling its
// private helpers into a public API risks leaking cache-management
// concerns. Duplication wins here.
//
// Why not `agentWizardInputSchema`: the stored YAML uses snake_case keys
// (`tool_allowlist`, `baseline_docs`, `system_prompt_snippet`) while the
// wizard schema uses camelCase. Threading a case-transform through the
// schema would be more code than the manual reads below, and the
// resolver needs to remain decoupled from wizard-layer policy (e.g. the
// wizard's model allowlist) — the resolver treats whatever is on disk
// as source-of-truth and leaves gating to the caller.

import { and, eq, isNull } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db } from '@/db';
import { documents } from '@/db/schema';

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

export const PLATFORM_AGENT_SLUG = 'platform-agent';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface AgentRuntimeConfig {
  id: string;
  slug: string;
  model: string;
  toolAllowlist: string[] | null; // null = unrestricted
  skillIds: string[];
  baselineDocIds: string[];
  systemPromptSnippet: string;
  capabilities: string[];
}

// ---------------------------------------------------------------------------
// Exported errors
// ---------------------------------------------------------------------------

export class AgentNotFoundError extends Error {
  readonly slug: string;
  constructor(slug: string) {
    super(`Agent not found: "${slug}"`);
    this.name = 'AgentNotFoundError';
    this.slug = slug;
  }
}

// ---------------------------------------------------------------------------
// Frontmatter helpers (Option A — local copies)
//
// Semantics are identical to the module-private versions in
// `src/lib/context/repos.ts`. Keep in sync if either changes.
// ---------------------------------------------------------------------------

function parseFrontmatterYaml(raw: string): Record<string, unknown> {
  if (!raw.startsWith('---\n')) return {};
  const closeIdx = raw.indexOf('\n---', 4);
  if (closeIdx === -1) return {};
  const block = raw.slice(4, closeIdx);
  try {
    const parsed = yaml.load(block);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function readStringField(
  fm: Record<string, unknown>,
  key: string,
): string | null {
  const v = fm[key];
  return typeof v === 'string' ? v : null;
}

function readStringArrayField(
  fm: Record<string, unknown>,
  key: string,
): string[] {
  const v = fm[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/**
 * Read `tool_allowlist` from frontmatter with three-way semantics:
 *   - key absent or non-array-and-non-null → `null`  (unrestricted)
 *   - key is explicitly `null`              → `null`  (unrestricted)
 *   - key is an array                       → filtered string[]
 *
 * An empty array `[]` is intentionally distinct from `null`: it means
 * "no tools allowed" and must be preserved as `[]`.
 */
function readToolAllowlist(fm: Record<string, unknown>): string[] | null {
  const v = fm['tool_allowlist'];
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === 'string');
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve an agent slug to its runtime config.
 *
 * - `slug === null`                  → `null` (platform agent, implicit)
 * - `slug === PLATFORM_AGENT_SLUG`   → `null` (platform agent, explicit)
 * - otherwise                        → look up `agent-definition` doc in DB
 *
 * Throws `AgentNotFoundError` when the slug doesn't match a live
 * agent-definition doc in the given brain.
 *
 * Throws a plain `Error` when the doc exists but lacks a `model` field
 * (data corruption, not a missing agent).
 */
export async function resolveAgentConfigBySlug(
  brainId: string,
  slug: string | null,
): Promise<AgentRuntimeConfig | null> {
  // Platform agent — no DB lookup needed.
  if (slug === null || slug === PLATFORM_AGENT_SLUG) return null;

  const rows = await db
    .select({
      id: documents.id,
      content: documents.content,
    })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, brainId),
        eq(documents.slug, slug),
        eq(documents.type, 'agent-definition'),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new AgentNotFoundError(slug);

  const fm = parseFrontmatterYaml(row.content);

  // Treat absent and empty-string `model` identically — both signal a
  // corrupt or partially-written agent-definition doc. Explicit check
  // (rather than `!model`) documents the intent: `0`, `false`, etc. are
  // already impossible here since `readStringField` returns `null` for
  // any non-string value.
  const model = readStringField(fm, 'model');
  if (model === null || model === '') {
    throw new Error(`Agent definition '${slug}' has no 'model' field`);
  }

  return {
    id: row.id,
    slug,
    model,
    toolAllowlist: readToolAllowlist(fm),
    skillIds: readStringArrayField(fm, 'skills'),
    baselineDocIds: readStringArrayField(fm, 'baseline_docs'),
    systemPromptSnippet: readStringField(fm, 'system_prompt_snippet') ?? '',
    capabilities: readStringArrayField(fm, 'capabilities'),
  };
}

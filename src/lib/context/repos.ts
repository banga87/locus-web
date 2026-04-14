// Drizzle-backed `ScaffoldingRepo` factory.
//
// This is the one file in `src/lib/context/` that talks to the DB —
// `scaffolding.ts` stays pure so it can be unit-tested without a
// Postgres connection. Callers construct the repo lazily per request
// (the SessionStart handler does this in `./register.ts`) so the
// factory must stay cheap — we hand back a fresh object with methods
// bound to the shared Drizzle client and rely on the process-local
// cache below for expensive work.
//
// Why parse frontmatter with `js-yaml` instead of `parseFrontmatterRaw`:
// the lightweight parser in `src/lib/brain/save.ts` only handles
// scalars (no YAML arrays or nested objects). Agent-definition docs
// carry `baseline_docs:` and `skills:` as YAML arrays — the wizard
// writes them with `yaml.dump` (see `src/lib/agents/definitions.ts`).
// Using `js-yaml` on both sides keeps the round-trip symmetric; the
// dependency is already pulled in for the skill manifest compiler.
//
// Scaffolding cache:
//   - Keyed by `${companyId}::${version}`. A version bump on save
//     yields a new cache key, so stale entries are never served —
//     they just linger until eviction.
//   - Bounded via an `LRU`-ish Map with an insertion-order eviction
//     (Map iteration preserves insertion order in ES2015+). Capacity
//     is 100 entries: ~100 tenants × one scaffolding doc each, at a
//     few KB per entry that's <1 MB worst-case resident. Re-tune if
//     we cross into multi-tenant-per-process territory.
//   - Lifetime: process. The assumption is single-instance MVP
//     deployment. Phase 2 moves this to a shared cache (e.g. Upstash
//     Redis via the Vercel Marketplace) when the autonomous loop
//     starts running on separate workers.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { loadManifest } from '@/lib/skills/loader';
import type { SkillManifest } from '@/lib/skills/manifest-compiler';

import type { ScaffoldingRepo } from './scaffolding';
import type { UserPromptRepo } from './user-prompt';

// ---- Scaffolding cache ----------------------------------------------------
//
// Cache key is (companyId, version) where `version` prefers the
// frontmatter `version:` field (user-visible — the wizard increments
// it on save) and falls back to the DB row's auto-incremented
// `version` column when the frontmatter omits it. Both bump on save,
// so any change invalidates the cache entry deterministically: a new
// save produces a new key, and the stale entry lingers until eviction.
//
// Eviction is insertion-order bounded at `SCAFFOLDING_CACHE_MAX` —
// not strictly LRU, though with version-keyed entries insertion order
// is effectively recency anyway. A touch-on-read nudges hit keys to
// the back of the iteration order so idle entries get dropped first.

interface CachedScaffolding {
  id: string;
  title: string;
  body: string;
  version: number;
}

const SCAFFOLDING_CACHE_MAX = 100;
const scaffoldingCache = new Map<string, CachedScaffolding>();

function cacheKey(companyId: string, version: number): string {
  return `${companyId}::${version}`;
}

function cacheGet(key: string): CachedScaffolding | undefined {
  const hit = scaffoldingCache.get(key);
  if (!hit) return undefined;
  // Touch for LRU ordering: delete + re-insert moves the key to the
  // end of the iteration order, so the next eviction drops whichever
  // entry has been idle longest.
  scaffoldingCache.delete(key);
  scaffoldingCache.set(key, hit);
  return hit;
}

function cachePut(key: string, value: CachedScaffolding): void {
  if (scaffoldingCache.size >= SCAFFOLDING_CACHE_MAX) {
    const oldest = scaffoldingCache.keys().next().value;
    if (oldest !== undefined) scaffoldingCache.delete(oldest);
  }
  scaffoldingCache.set(key, value);
}

/**
 * Clear the process-local scaffolding cache. Test-only — production
 * code never calls this; cache entries expire naturally when the
 * version number advances on save.
 */
export function __clearScaffoldingCacheForTests(): void {
  scaffoldingCache.clear();
}

// ---- Frontmatter helpers --------------------------------------------------

/**
 * Parse a frontmatter block from a document's raw content. Returns
 * `{}` when there is no preamble or the YAML is malformed — callers
 * handle missing keys by short-circuiting the relevant fetch path.
 *
 * Why `js-yaml` instead of `parseFrontmatterRaw`: arrays. The
 * agent-definition doc embeds `baseline_docs:` and `skills:` as YAML
 * arrays; scalars-only parsing would drop them. See the module header.
 */
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
    // Malformed YAML: treat as empty. The scaffolding and agent-
    // definition repos already degrade on empty / missing frontmatter,
    // so a warning here would double up on existing diagnostics.
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

function readNumberField(
  fm: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = fm[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readStringArrayField(
  fm: Record<string, unknown>,
  key: string,
): string[] {
  const v = fm[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

// ---- Repo factory ---------------------------------------------------------

/**
 * Build a Drizzle-backed ScaffoldingRepo. Safe to call per request —
 * the returned object is a thin closure over the shared `db` client
 * and the process-local cache. Never throws at construction time;
 * per-method calls return `null` / `[]` on expected-miss paths and
 * only propagate transport-level failures (connection errors) that
 * the SessionStart handler wraps in a try/catch.
 */
export function createDbScaffoldingRepo(): ScaffoldingRepo {
  return {
    async getAgentScaffolding(companyId) {
      // Pull the single `agent-scaffolding` row for this company.
      // Enforced unique per company by
      // `documents_company_scaffolding_unique` (migration 0008), but
      // we still `limit(1)` to keep the contract explicit.
      const rows = await db
        .select({
          id: documents.id,
          title: documents.title,
          content: documents.content,
          rowVersion: documents.version,
        })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, companyId),
            eq(documents.type, 'agent-scaffolding'),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      // Prefer the frontmatter `version` field when present; fall back
      // to the row's auto-incremented `version` column. Either is a
      // valid cache key — the wizard's save path bumps both.
      const fm = parseFrontmatterYaml(row.content);
      const version = readNumberField(fm, 'version', row.rowVersion);

      const key = cacheKey(companyId, version);
      const cached = cacheGet(key);
      if (cached) return cached;

      // The body the agent sees is the full doc content minus the
      // frontmatter block. Scaffolding is authored as human-readable
      // prose; stripping the YAML keeps the injected context clean.
      const body = stripFrontmatter(row.content);

      const value: CachedScaffolding = {
        id: row.id,
        title: row.title,
        body,
        version,
      };
      cachePut(key, value);
      return value;
    },

    async getAgentDefinition(id) {
      const rows = await db
        .select({
          id: documents.id,
          title: documents.title,
          content: documents.content,
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, id),
            eq(documents.type, 'agent-definition'),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      // Agent-definitions are frontmatter-only (the wizard writes no
      // body). All fields we care about live in the YAML.
      const fm = parseFrontmatterYaml(row.content);
      const systemPromptSnippet =
        readStringField(fm, 'system_prompt_snippet') ?? '';
      const baselineDocIds = readStringArrayField(fm, 'baseline_docs');

      return {
        id: row.id,
        title: row.title,
        systemPromptSnippet,
        baselineDocIds,
      };
    },

    async getDocsByIds(ids) {
      // Short-circuit an empty IN () — Drizzle / Postgres tolerate it
      // but the round trip is pointless. Guard here so callers can
      // pass through their raw arrays without pre-checking.
      if (ids.length === 0) return [];

      const rows = await db
        .select({
          id: documents.id,
          title: documents.title,
          content: documents.content,
          status: documents.status,
        })
        .from(documents)
        .where(
          and(inArray(documents.id, ids), isNull(documents.deletedAt)),
        );

      // Preserve the caller's request order — `IN (...)` is unordered.
      // The scaffolding payload relies on baseline docs landing in the
      // order the wizard recorded them.
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map((r) => ({
          id: r.id,
          title: r.title,
          body: stripFrontmatter(r.content),
          status: r.status,
        }));
    },
  };
}

/**
 * Strip a YAML frontmatter preamble from document content. Returns
 * the content unchanged when there is no preamble. Used by the
 * scaffolding + baseline reads so the injected body is just the
 * Markdown the agent needs — no `---\ntype: ...\n---\n` noise.
 *
 * Exported for the integration test to seed docs with a frontmatter
 * block and assert the injected block matches the raw body.
 */
export function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---\n')) return raw;
  const closeIdx = raw.indexOf('\n---', 4);
  if (closeIdx === -1) return raw;
  // Drop the frontmatter block and the closing `---` marker plus its
  // trailing newline (if any). The body starts at the first character
  // after `\n---\n`.
  const after = raw.slice(closeIdx + '\n---'.length);
  return after.startsWith('\n') ? after.slice(1) : after;
}

// ---- UserPromptSubmit repo ------------------------------------------------
//
// Drizzle-backed `UserPromptRepo` factory. The shape lives in
// `./user-prompt.ts` so the pure builder stays platform-agnostic.
// Mirrors the scaffolding-repo pattern: a thin closure over `db`; no
// state beyond shared Drizzle client and its own caching layers
// (the skill manifest owns its own cache in `src/lib/skills/loader.ts`).

/**
 * Build a Drizzle-backed UserPromptRepo. Safe to call per request —
 * the returned object is a thin closure. Two of the four methods are
 * stubs pending downstream tasks:
 *
 *   - `getExtractedAttachments` — Task 8 wires up
 *     `session_attachments` reads. Returns `[]` until then.
 *   - `getIngestionFilingSkill` — Task 10 seeds the built-in
 *     `ingestion-filing` skill doc. Returns `null` until the seed is
 *     present in the company's brain.
 *
 * The skill-matching half (getManifest + getSkillBodies) is fully
 * wired; the Phase 1.5 plan explicitly orders Task 6 ahead of Tasks
 * 8 + 10 so the UserPromptSubmit handler lands in one pass.
 */
export function createDbUserPromptRepo(): UserPromptRepo {
  return {
    async getManifest(companyId) {
      // Delegates to the skill-loader's `loadManifest`, which reads
      // from `skill_manifests.manifest` (a JSONB blob populated by
      // `rebuildManifest`). The loader returns `SkillManifest | null`;
      // we return that through unchanged.
      return loadManifest(companyId) as Promise<SkillManifest | null>;
    },

    async getSkillBodies(ids) {
      // Short-circuit an empty IN () — Drizzle / Postgres tolerate it
      // but the round trip is pointless. Guard here so callers can
      // hand through raw id arrays (the matcher's output is unbounded
      // in principle; in practice the manifest caps at whatever the
      // user authored, but defence-in-depth is cheap).
      if (ids.length === 0) return [];

      // Filter by `type = 'skill'` + `deletedAt IS NULL` so soft-
      // deleted or retyped docs never leak through. Company isolation
      // is enforced transitively — the matcher only proposes ids that
      // came from this company's manifest, so the ids themselves
      // carry the company scope.
      const rows = await db
        .select({
          id: documents.id,
          content: documents.content,
        })
        .from(documents)
        .where(
          and(
            inArray(documents.id, ids),
            eq(documents.type, 'skill'),
            isNull(documents.deletedAt),
          ),
        );

      return rows.map((r) => ({
        id: r.id,
        body: stripFrontmatter(r.content),
      }));
    },

    async getExtractedAttachments(sessionId) {
      // TODO(Task 8): replace with a Drizzle query
      //   SELECT id, filename, extracted_text, size_bytes
      //   FROM session_attachments
      //   WHERE session_id = ? AND status = 'extracted' AND extracted_text IS NOT NULL
      //   ORDER BY created_at DESC
      // When Task 8 lands it will map `size_bytes` (bigint) to `number`
      // via `Number(r.sizeBytes)` — safe for typical attachment sizes.
      // Until then the user-prompt builder short-circuits the
      // attachment branch and no ingestion-filing block lands either.
      void sessionId;
      return [];
    },

    async getIngestionFilingSkill(companyId) {
      // TODO(Task 10): query the built-in ingestion-filing skill by
      // stable slug (seeded per company — e.g.
      // `eq(documents.slug, 'ingestion-filing')` plus the usual
      // company + type + deletedAt guards). Returning `null` until
      // Task 10 ships keeps us safe from accidentally matching a
      // user's own skill-type doc that happens to contain
      // "ingestion" or "filing" in its title (an earlier draft used
      // `ilike(title, '%ingestion filing%')` and would have silently
      // injected e.g. "Canada Ingestion Filing SOPs" on every
      // attachment turn).
      //
      // The builder already tolerates `null` gracefully — attachment
      // blocks still land, just without the filing companion block.
      void companyId;
      return null;
    },
  };
}

// ---- Agent skills lookup (lightweight sibling repo) ----------------------
//
// The UserPromptSubmit handler needs the agent-definition's
// `skills:` frontmatter array. `ScaffoldingRepo.getAgentDefinition`
// already reads the same doc but returns `baseline_docs`, not
// `skills`. Rather than widen that method's return shape (which
// would couple the SessionStart path to skill-matching concerns),
// we expose a focused lookup here.
//
// Future: when Phase 2 adds more per-turn agent-definition fields
// (tool allowlists, etc.) we can consolidate into a single
// `AgentDefinitionRepo`; for MVP the two-call split is trivial.

export interface AgentSkillsRepo {
  /**
   * Return the agent-definition doc's `skills:` frontmatter array,
   * or `null` when the doc is missing / soft-deleted / mistyped. The
   * register.ts handler treats `null` as "no candidate pool" and
   * skips skill matching for the turn.
   */
  getAgentSkillIds(agentDefinitionId: string): Promise<string[] | null>;
}

/**
 * Drizzle-backed `AgentSkillsRepo`. Re-uses the local frontmatter
 * helpers (same js-yaml dependency as the scaffolding repo); company
 * isolation is enforced at call time — the register.ts wrapper only
 * passes through `ctx.agentDefinitionId` when the session already
 * belongs to the caller's company.
 */
export function createDbAgentSkillsRepo(): AgentSkillsRepo {
  return {
    async getAgentSkillIds(agentDefinitionId) {
      const rows = await db
        .select({ content: documents.content })
        .from(documents)
        .where(
          and(
            eq(documents.id, agentDefinitionId),
            eq(documents.type, 'agent-definition'),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      const fm = parseFrontmatterYaml(row.content);
      return readStringArrayField(fm, 'skills');
    },
  };
}

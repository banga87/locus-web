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

import type { ScaffoldingRepo } from './scaffolding';

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

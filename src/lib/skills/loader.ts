// Skill manifest loader — DB-backed wrapper around the pure compiler.
//
// Responsibilities:
//   1. `scheduleManifestRebuild(companyId)` — debounce-coalesces rebuild
//      requests from the brain write path. The brain doc routes call
//      this on every skill insert/update/delete; a burst of edits within
//      5s collapses to a single rebuild.
//   2. `rebuildManifest(companyId)` — read all `skill` docs for the
//      company, run them through `compileSkillDocs`, upsert the result
//      into `skill_manifests`. Idempotent.
//   3. `loadManifest(companyId)` — read the cached manifest. The matcher
//      calls this on every chat turn that runs a skill-aware agent.
//
// Debounce design: a single in-process `Map<companyId, NodeJS.Timeout>`.
// MVP is single-instance — for multi-instance deployment this would need
// a Redis-backed coalescer (see Phase 1.5 design spec). The spec
// explicitly accepts the single-instance limitation, so this stays
// simple on purpose; do not bolt on a queue here.
//
// Error handling: rebuild failures must not break writes. The scheduler
// catches and logs; the brain save-path is unaware of rebuild outcomes.
// On failure the previous manifest stays in place — stale-but-correct
// beats blank-and-broken for the matcher.

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents, skillManifests } from '@/db/schema';

import { compileSkillDocs, type SkillManifest } from './manifest-compiler';

// One pending timer per company. The Map key is the company id; value is
// the active setTimeout handle. New schedule calls clear and replace.
const pendingRebuilds = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 5_000;

/**
 * Schedule a manifest rebuild for the given company, coalescing with
 * any rebuild already pending. Returns immediately; the actual rebuild
 * runs ~5s later. Failures are logged, never thrown — the caller has
 * already committed the underlying write and shouldn't care about
 * cache-refresh outcomes.
 */
export function scheduleManifestRebuild(companyId: string): void {
  const existing = pendingRebuilds.get(companyId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    pendingRebuilds.delete(companyId);
    rebuildManifest(companyId).catch((err) => {
      console.warn(`[skills/loader] rebuild failed for ${companyId}:`, err);
    });
  }, DEBOUNCE_MS);
  pendingRebuilds.set(companyId, t);
}

/**
 * Rebuild a company's skill manifest from scratch, reading every
 * `documents` row whose `type = 'skill'` and is not soft-deleted.
 * Upserts the result — there is exactly one manifest per company, keyed
 * on `companyId`.
 */
export async function rebuildManifest(companyId: string): Promise<void> {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
    })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.type, 'skill'),
        isNull(documents.deletedAt),
      ),
    );

  const manifest = compileSkillDocs(
    rows.map((r) => ({ ...r, companyId })),
  );

  const builtAt = new Date();
  await db
    .insert(skillManifests)
    .values({ companyId, manifest, builtAt })
    .onConflictDoUpdate({
      target: skillManifests.companyId,
      set: { manifest, builtAt },
    });
}

/**
 * Load the cached manifest for a company. Returns null when no rebuild
 * has been written yet. The matcher caller decides what to do with a
 * missing manifest (typically: skip skill injection for this turn).
 */
export async function loadManifest(
  companyId: string,
): Promise<SkillManifest | null> {
  const [row] = await db
    .select()
    .from(skillManifests)
    .where(eq(skillManifests.companyId, companyId))
    .limit(1);
  return (row?.manifest as SkillManifest | undefined) ?? null;
}

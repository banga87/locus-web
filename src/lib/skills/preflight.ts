// Triggered-skill pre-flight check — verifies required MCP connections are
// active before a run starts.
//
// `preflight` is called by the skill-run trigger route before inserting a
// workflow_run row. If pre-flight fails, the route returns a 4xx with the
// missing MCP slugs so the UI can prompt the user to connect them.

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { mcpConnections } from '@/db/schema/mcp-connections';
import type { SkillTrigger } from '@/lib/brain/frontmatter';

/** Tagged-union result: ok or a list of missing MCP slugs. */
export type PreflightResult =
  | { ok: true }
  | { ok: false; missing: string[] };

/**
 * Check that every MCP slug listed in `trigger.requires_mcps` has an
 * `active` connection for the given company.
 *
 * @param trigger    Validated skill trigger block (only `requires_mcps`
 *                   is consulted).
 * @param companyId  The company whose connections are checked.
 */
export async function preflight(
  trigger: SkillTrigger,
  companyId: string,
): Promise<PreflightResult> {
  const required = trigger.requires_mcps;

  // Fast-path: no requirements → always passes.
  if (required.length === 0) {
    return { ok: true };
  }

  // Match on `catalog_id` — the stable slug written when a connection is
  // installed from the catalog (see `installFromCatalog` in
  // `src/app/api/admin/connectors/route.ts`). `name` is a user-editable
  // display label ("Linear") and must not be used as an identifier.
  // Custom user-added connections have `catalog_id = null` and therefore
  // cannot satisfy a `requires_mcps` slug, which is correct.
  const connected = await db
    .select({ catalogId: mcpConnections.catalogId })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        eq(mcpConnections.status, 'active'),
        inArray(mcpConnections.catalogId, required),
      ),
    );

  const connectedSlugs = new Set(
    connected
      .map((c) => c.catalogId)
      .filter((s): s is string => s !== null),
  );
  const missing = required.filter((slug) => !connectedSlugs.has(slug));

  if (missing.length === 0) {
    return { ok: true };
  }

  return { ok: false, missing };
}

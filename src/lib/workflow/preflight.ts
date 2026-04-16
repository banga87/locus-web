// Workflow pre-flight check — verifies required MCP connections are active
// before a run starts.
//
// `preflight` is called by the run trigger (Task 6 route) before inserting a
// workflow_run row. If pre-flight fails, the route returns a 4xx with the
// missing MCP slugs so the UI can prompt the user to connect them.

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { mcpConnections } from '@/db/schema/mcp-connections';

/** Minimum workflow frontmatter shape needed for pre-flight. */
interface WorkflowPreflightInput {
  requires_mcps: string[];
}

/** Tagged-union result: ok or a list of missing MCP slugs. */
export type PreflightResult =
  | { ok: true }
  | { ok: false; missing: string[] };

/**
 * Check that every MCP slug listed in `requires_mcps` has an `active`
 * connection for the given company.
 *
 * @param frontmatter  Workflow frontmatter (only `requires_mcps` is used).
 * @param companyId    The company whose connections are checked.
 */
export async function preflight(
  frontmatter: WorkflowPreflightInput,
  companyId: string,
): Promise<PreflightResult> {
  const required = frontmatter.requires_mcps;

  // Fast-path: no requirements → always passes.
  if (required.length === 0) {
    return { ok: true };
  }

  // Query active connections whose name matches one of the required slugs.
  const connected = await db
    .select({ name: mcpConnections.name })
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.companyId, companyId),
        eq(mcpConnections.status, 'active'),
        inArray(mcpConnections.name, required),
      ),
    );

  const connectedNames = new Set(connected.map((c) => c.name));
  const missing = required.filter((slug) => !connectedNames.has(slug));

  if (missing.length === 0) {
    return { ok: true };
  }

  return { ok: false, missing };
}

// GET /api/skills/runs/[id] — return the workflow_run row.
//
// Relocated from /api/workflows/runs/[id] during the skill/workflow
// unification. The HTTP surface is id-based + lives under /skills/; the
// underlying table keeps the name `workflow_runs` (operational artefact).
//
// Access control delegated to `canAccessRun()` in @/lib/workflow/access.
// Three rules apply: tenant isolation (auth.companyId == run.companyId),
// triggered-by match, or Owner/Admin role within the same tenant.
//
// On denial we return 404, not 403 — a 403 would confirm that the UUID
// exists (just that the caller can't see it), which leaks information
// across tenants. The trigger route uses the same approach for
// cross-tenant skill docs.

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { canAccessRun } from '@/lib/workflow/access';
import { getWorkflowRunById } from '@/lib/workflow/queries';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let auth;
  try {
    auth = await requireAuth();
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    throw err;
  }

  const { id } = await params;
  const run = await getWorkflowRunById(id);

  if (!run) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  if (!canAccessRun(run, auth)) {
    // 404 (not 403) — do not confirm existence of a UUID belonging to
    // another tenant or to a different user. Matches the trigger
    // route's cross-tenant handling.
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  return Response.json(run);
}

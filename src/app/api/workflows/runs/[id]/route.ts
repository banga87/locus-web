// GET /api/workflows/runs/[id] — return the workflow_run row.
//
// Access control: the caller must be the user who triggered the run
// (triggered_by == auth.userId) OR have Owner/Admin role.
//
// Simplification note (Phase 1.5): Owner/Admin check uses users.role from
// requireAuth() — no extra DB query needed because requireAuth already loads
// the role from the public.users table.

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
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

  // Access control: triggered_by match OR Owner/Admin role.
  const isOwnerOrAdmin = auth.role === 'owner' || auth.role === 'admin';
  const isTriggeredBy = run.triggeredBy === auth.userId;

  if (!isTriggeredBy && !isOwnerOrAdmin) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  return Response.json(run);
}

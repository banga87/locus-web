// POST /api/workflows/runs/[id]/cancel — cancel a running workflow run.
//
// State machine: only `running → cancelled` is permitted. If the run is
// already in a terminal state (completed / failed / cancelled), the route
// returns 409 Conflict with the current status — prevents stale clients
// from double-cancelling.
//
// updated_at is bumped via the cancelWorkflowRun query helper which uses
// sql`now()` — consistent with all status.ts helpers. This is load-bearing
// for the zombie sweeper: if updated_at were not bumped, a cancelled run
// would appear "stuck" and get wrongly promoted to failed.
//
// Access control: triggered_by OR Owner/Admin (same as status route).

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getWorkflowRunById, cancelWorkflowRun } from '@/lib/workflow/queries';

export const runtime = 'nodejs';

export async function POST(
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

  // State machine guard: only allow running → cancelled.
  if (run.status !== 'running') {
    return Response.json(
      { error: 'conflict', current_status: run.status },
      { status: 409 },
    );
  }

  // Atomically flip running → cancelled. cancelWorkflowRun applies a
  // WHERE status = 'running' guard so a concurrent completion racing this
  // cancel does not corrupt the terminal state.
  const updated = await cancelWorkflowRun(id);

  if (!updated) {
    // Race condition: the run completed/failed between our read and the
    // update. Re-read to return the actual current status.
    const latest = await getWorkflowRunById(id);
    return Response.json(
      {
        error: 'conflict',
        message: 'Run reached a terminal state before cancel landed.',
        current_status: latest?.status ?? 'unknown',
      },
      { status: 409 },
    );
  }

  return Response.json({ run_id: id, status: 'cancelled' });
}

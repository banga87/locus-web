// GET /api/workflows/runs/[id]/events — return events for a workflow run.
//
// Returns all events for the run ordered by sequence ascending.
// Supports ?after=<seq> for incremental fetch: used by the UI on Realtime
// reconnect to backfill any events missed while the channel was detached
// (SWR polls this route once before the Realtime subscription reattaches).
//
// Access control: same as the status route — triggered_by OR Owner/Admin.

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { getWorkflowRunById, getRunEvents } from '@/lib/workflow/queries';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
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

  // Parse optional ?after=<seq> query param.
  const url = new URL(req.url);
  const afterRaw = url.searchParams.get('after');
  const after = afterRaw !== null ? Number(afterRaw) : undefined;

  const events = await getRunEvents(id, after);

  return Response.json({ events });
}

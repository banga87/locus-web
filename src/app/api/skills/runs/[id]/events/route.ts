// GET /api/skills/runs/[id]/events — return events for a triggered-skill run.
//
// Relocated from /api/workflows/runs/[id]/events during the skill/workflow
// unification. The HTTP surface lives under /skills/; the underlying table
// keeps the name `workflow_run_events` (operational artefact).
//
// Returns all events for the run ordered by sequence ascending.
// Supports ?after=<seq> for incremental fetch: used by the UI on Realtime
// reconnect to backfill any events missed while the channel was detached
// (SWR polls this route once before the Realtime subscription reattaches).
//
// Access control delegated to canAccessRun() — tenant isolation,
// triggered-by match, or Owner/Admin within the same tenant. Denial
// returns 404 to avoid leaking UUID existence across tenants.
//
// `?after` validation: a non-numeric string would previously coerce to
// NaN via Number() and be silently accepted — `gt(sequence, NaN)`
// returns zero rows. The UI then sees `{events: []}` without any error
// signal, which hides misconfigured clients. Reject non-integer input
// with a 400 instead.

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { canAccessRun } from '@/lib/workflow/access';
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

  if (!canAccessRun(run, auth)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // Parse + validate ?after=<seq>. Regex rather than parseInt + isNaN
  // because it also rejects negatives, scientific notation, and leading
  // whitespace — all of which parseInt would silently accept.
  const afterRaw = new URL(req.url).searchParams.get('after');
  let after: number | undefined;
  if (afterRaw !== null) {
    if (!/^\d+$/.test(afterRaw)) {
      return Response.json(
        {
          error: 'invalid_param',
          message: '?after must be a non-negative integer',
        },
        { status: 400 },
      );
    }
    after = parseInt(afterRaw, 10);
  }

  const events = await getRunEvents(id, after);

  return Response.json({ events });
}

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
//
// Audit trail: emits a `workflow.run.cancelled` event (category:
// 'administration', actorType: 'human') on successful state transition.
// The audit event is only emitted when the UPDATE actually landed — if
// cancelWorkflowRun returns null (race: run reached a terminal state
// between the read and the guarded update), no event is emitted because
// no state change occurred. `waitUntil(flushEvents())` ensures the
// buffered audit write lands before the function shuts down.

import { waitUntil } from '@vercel/functions';

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { flushEvents, logEvent } from '@/lib/audit/logger';
import type { TargetType } from '@/lib/audit/types';
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
    // update. Re-read to return the actual current status. Intentionally
    // no audit emit here — no state change occurred on this call.
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

  // Confirmed state change: emit the audit event. Naming convention
  // matches `mcp.connection.{created,updated,disabled,deleted}` in
  // src/app/api/admin/mcp-connections — dotted lowercase, domain-scoped.
  //
  // TargetType note: the `TargetType` union in src/lib/audit/types.ts
  // does not yet list 'workflow_run'. The underlying column is
  // `varchar(64)` so the DB accepts it without a migration; we cast to
  // keep this route within scope (widening the shared type is a
  // separate change). Future audit-hygiene work should extend the
  // union alongside any other workflow-audit event types we add.
  logEvent({
    companyId: auth.companyId!,
    category: 'administration',
    eventType: 'workflow.run.cancelled',
    actorType: 'human',
    actorId: auth.userId,
    actorName: auth.fullName ?? undefined,
    targetType: 'workflow_run' as TargetType,
    targetId: id,
    details: {
      workflow_document_id: run.workflowDocumentId,
      triggered_by: run.triggeredBy,
      previous_status: 'running',
    },
  });

  // logEvent buffers + drains on a microtask. waitUntil(flushEvents())
  // keeps the function alive long enough for the buffered write to land
  // after the response stream closes — same pattern as the chat route.
  waitUntil(flushEvents());

  return Response.json({ run_id: id, status: 'cancelled' });
}

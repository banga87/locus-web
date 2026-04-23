// POST /api/workflows/runs — trigger a workflow run.
//
// This route is a thin HTTP adapter. All business logic lives in
// src/lib/workflow/ per the harness-boundary contract in AGENTS.md.
//
// Flow:
//   1. Authenticate (requireAuth).
//   2. Load the workflow document — return 404 if missing or wrong type.
//   3. Run pre-flight check — return 400 with missing MCP slugs if it fails.
//   4. Insert the workflow_run row (status='running').
//   5. Hand off to runWorkflow via waitUntil so the HTTP response returns
//      immediately with 202 while the run executes in the background.
//
// DELIBERATE: direct runWorkflow() call under waitUntil (Approach B).
// We are NOT using Vercel Workflow DevKit's start() from @vercel/workflow/api.
// That is the documented upgrade path when run durations exceed Fluid Compute
// limits. See spec Section 6 "Upgrade Seams" and Section 2 "Philosophy" for
// the trade-off reasoning.
//
// Actor role plumbing: requireAuth() loads users.role from the DB and returns
// it on the AuthContext. The trigger route does NOT need to build a full
// AgentContext here — runWorkflow() builds its own context internally using
// the run.triggeredBy userId. The role check for write-tool access inside the
// runner is already wired in run.ts (sets scopes: ['read', 'write'] directly).
//
// Note: the chat route (src/app/api/agent/chat/route.ts) still constructs
// its AgentActor with scopes: ['read'] and no role field. That is a known
// gap tracked separately — this task does not modify the chat route (scope
// discipline: this task is workflows API routes only).
//
// Runtime: Node.js (waitUntil requires Node runtime).
// maxDuration: 10s — just enough for the trigger path; the actual run lives
// in the waitUntil promise which is not bound by the response timeout.

import { waitUntil } from '@vercel/functions';

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { runTriggeredSkill } from '@/lib/skills/run-triggered';
import { preflight } from '@/lib/skills/preflight';
import { validateWorkflowFrontmatter } from '@/lib/brain/frontmatter';
import {
  getWorkflowDocById,
  createWorkflowRun,
} from '@/lib/workflow/queries';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: Request) {
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

  if (!auth.companyId) {
    return Response.json(
      { error: 'no_company', message: 'Complete setup before triggering workflows.' },
      { status: 403 },
    );
  }

  // Role gate: viewers cannot trigger workflows. A viewer-triggered workflow
  // would fail-closed on the first write tool inside the runner (Task 1's
  // evaluator denies write tools for viewers), so we pre-reject here rather
  // than waste infrastructure and leave a failed run row behind. Placed
  // before doc lookup so a viewer can't probe which workflow IDs exist.
  if (auth.role === 'viewer') {
    return Response.json(
      {
        error: 'forbidden',
        message:
          'Viewers cannot trigger workflows. Ask an editor or owner to trigger it.',
      },
      { status: 403 },
    );
  }

  let body: { workflow_document_id?: unknown };
  try {
    body = (await req.json()) as { workflow_document_id?: unknown };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { workflow_document_id } = body;
  if (typeof workflow_document_id !== 'string' || !workflow_document_id) {
    return Response.json(
      { error: 'missing_field', message: 'workflow_document_id is required.' },
      { status: 400 },
    );
  }

  const doc = await getWorkflowDocById(workflow_document_id);
  if (!doc || doc.type !== 'workflow') {
    return Response.json({ error: 'workflow_not_found' }, { status: 404 });
  }

  // Tenant isolation: ensure the workflow document belongs to the user's company.
  if (doc.companyId !== auth.companyId) {
    return Response.json({ error: 'workflow_not_found' }, { status: 404 });
  }

  // Validate frontmatter stored in documents.metadata — needed to extract
  // requires_mcps for the pre-flight check.
  //
  // `doc.type === 'workflow'` is established above (line 103). The authored
  // fields live in `metadata` but `type` is intentionally NOT mirrored there
  // — it's denormalised into the `documents.type` column by
  // extractDocumentTypeFromContent on save (see
  // src/app/api/brain/documents/[id]/route.ts and the paired POST handler).
  // So we inject `type: 'workflow'` before validating, matching the pattern
  // established in src/lib/frontmatter/schemas/workflow.ts.
  const fmResult = validateWorkflowFrontmatter({
    ...((doc.metadata as Record<string, unknown> | null) ?? {}),
    type: 'workflow',
  });
  if (!fmResult.ok) {
    return Response.json(
      {
        error: 'invalid_workflow',
        message: 'Workflow frontmatter is invalid.',
        details: fmResult.errors,
      },
      { status: 400 },
    );
  }

  const pre = await preflight(fmResult.value, auth.companyId);
  if (!pre.ok) {
    return Response.json(
      { error: 'missing_mcps', missing: pre.missing },
      { status: 400 },
    );
  }

  const runId = await createWorkflowRun({
    workflow_document_id,
    triggered_by: auth.userId,
    triggered_by_kind: 'manual',
  });

  // DELIBERATE: direct runWorkflow() call under waitUntil (Approach B in spec).
  // We are NOT using Vercel Workflow DevKit's start() from
  // @vercel/workflow/api — that is the Approach A path and is out of scope
  // for Phase 1.5. See spec Section 6 "Upgrade Seams" for rationale.
  waitUntil(runTriggeredSkill(runId));

  return Response.json(
    { run_id: runId, view_url: `/workflows/${doc.slug}/runs/${runId}` },
    { status: 202 },
  );
}

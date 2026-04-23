// POST /api/skills/runs — trigger a triggered-skill run.
//
// This route is a thin HTTP adapter. All business logic lives in
// src/lib/skills/ per the harness-boundary contract in AGENTS.md.
//
// Flow:
//   1. Authenticate (requireAuth).
//   2. Load the skill document — return 404 if missing or wrong type.
//   3. Validate the nested `metadata.trigger` block — return 400 with
//      `skill_not_triggerable` if absent or invalid.
//   4. Run pre-flight check — return 400 with missing MCP slugs if it fails.
//   5. Insert the workflow_run row (status='running').
//   6. Hand off to runTriggeredSkill via waitUntil so the HTTP response
//      returns immediately with 202 while the run executes in the background.
//
// DELIBERATE: direct runTriggeredSkill() call under waitUntil (Approach B).
// We are NOT using Vercel Workflow DevKit's start() from @vercel/workflow/api.
// That is the documented upgrade path when run durations exceed Fluid Compute
// limits. See spec Section 6 "Upgrade Seams" and Section 2 "Philosophy" for
// the trade-off reasoning.
//
// Actor role plumbing: requireAuth() loads users.role from the DB and returns
// it on the AuthContext. The trigger route does NOT need to build a full
// AgentContext here — runTriggeredSkill() builds its own context internally
// using the run.triggeredBy userId. The role check for write-tool access
// inside the runner is already wired in run-triggered.ts (sets scopes:
// ['read', 'write'] directly).
//
// Note: the chat route (src/app/api/agent/chat/route.ts) still constructs
// its AgentActor with scopes: ['read'] and no role field. That is a known
// gap tracked separately — this task does not modify the chat route (scope
// discipline: this task is the skill-trigger API route only).
//
// Runtime: Node.js (waitUntil requires Node runtime).
// maxDuration: 10s — just enough for the trigger path; the actual run lives
// in the waitUntil promise which is not bound by the response timeout.

import { waitUntil } from '@vercel/functions';

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { runTriggeredSkill } from '@/lib/skills/run-triggered';
import { preflight } from '@/lib/skills/preflight';
import { validateSkillTrigger } from '@/lib/brain/frontmatter';
import {
  getSkillDocById,
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
      { error: 'no_company', message: 'Complete setup before triggering skills.' },
      { status: 403 },
    );
  }

  // Role gate: viewers cannot trigger skills. A viewer-triggered run
  // would fail-closed on the first write tool inside the runner (Task 1's
  // evaluator denies write tools for viewers), so we pre-reject here rather
  // than waste infrastructure and leave a failed run row behind. Placed
  // before doc lookup so a viewer can't probe which skill IDs exist.
  if (auth.role === 'viewer') {
    return Response.json(
      {
        error: 'forbidden',
        message: 'Viewers cannot trigger skills. Ask an editor or owner to trigger it.',
      },
      { status: 403 },
    );
  }

  let body: { skill_document_id?: unknown };
  try {
    body = (await req.json()) as { skill_document_id?: unknown };
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { skill_document_id } = body;
  if (typeof skill_document_id !== 'string' || !skill_document_id) {
    return Response.json(
      { error: 'missing_field', message: 'skill_document_id is required.' },
      { status: 400 },
    );
  }

  const doc = await getSkillDocById(skill_document_id);
  if (!doc || doc.type !== 'skill') {
    return Response.json({ error: 'skill_not_found' }, { status: 404 });
  }

  // Tenant isolation: ensure the skill document belongs to the user's company.
  if (doc.companyId !== auth.companyId) {
    return Response.json({ error: 'skill_not_found' }, { status: 404 });
  }

  // Validate the trigger block stored under documents.metadata.trigger. A skill
  // without a trigger block is not runnable via this route — reject with
  // `skill_not_triggerable` and the validation errors so the UI can surface
  // what's missing.
  const metadata = (doc.metadata as Record<string, unknown> | null) ?? {};
  const triggerRaw = metadata['trigger'];
  if (triggerRaw === undefined || triggerRaw === null) {
    return Response.json(
      {
        error: 'skill_not_triggerable',
        message:
          'Skill has no trigger block. Add a `trigger:` block in the frontmatter to make this skill runnable.',
      },
      { status: 400 },
    );
  }

  const fmResult = validateSkillTrigger(triggerRaw);
  if (!fmResult.ok) {
    return Response.json(
      {
        error: 'skill_not_triggerable',
        message: 'Skill trigger block is invalid.',
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
    workflow_document_id: skill_document_id,
    triggered_by: auth.userId,
    triggered_by_kind: 'manual',
  });

  // DELIBERATE: direct runTriggeredSkill() call under waitUntil (Approach B
  // in spec). We are NOT using Vercel Workflow DevKit's start() from
  // @vercel/workflow/api — that is the Approach A path and is out of scope
  // for Phase 1.5. See spec Section 6 "Upgrade Seams" for rationale.
  waitUntil(runTriggeredSkill(runId));

  return Response.json(
    { run_id: runId, view_url: `/skills/${doc.id}/runs/${runId}` },
    { status: 202 },
  );
}

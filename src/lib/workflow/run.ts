// runWorkflow — top-level workflow execution entry point.
//
// Called from the Task 6 API route via waitUntil so it runs in the
// background after the HTTP response is sent. This file is deliberately
// outside src/lib/agent/ (the platform-agnostic harness) so it can freely
// import DB helpers, Next.js-adjacent utilities, and workflow-specific
// modules without violating the harness boundary.
//
// Execution model (single-agent, single-turn loop):
//   1. Load the workflow_run + workflow document from DB.
//   2. Run pre-cancellation check — exit early if already cancelled.
//   3. markRunning — transitions status and anchors updated_at.
//   4. Build tool set (all registered Locus tools) wrapped with stamp middleware.
//   5. Build system prompt = base prompt + workflow preamble.
//   6. Drive runAgentTurn with the workflow body as the user message.
//   7. Stream events → insertEvent per event, accumulate token counts.
//   8. At turn_start events: check for cancellation and exit if detected.
//   9. On normal completion: insertEvent(run_complete) + markCompleted.
//  10. On error: insertEvent(run_error) + markFailed.
//
// Cancellation granularity: checked at turn_start boundaries ONLY.
// Per spec Section 6, mid-tool-call cancellation is deferred. One
// in-flight LLM turn + any tool calls it triggers may complete before
// the runner stops.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { companies } from '@/db/schema/companies';
import { users } from '@/db/schema/users';

import { runAgentTurn } from '@/lib/agent/run';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';
import { buildToolSet } from '@/lib/agent/tool-bridge';
import { registerLocusTools } from '@/lib/tools';
import { validateWorkflowFrontmatter } from '@/lib/brain/frontmatter';

import { insertEvent } from './events';
import { markRunning, markCompleted, markFailed, markCancelled, getRunStatus } from './status';
import { buildWorkflowSystemPrompt } from './system-prompt';
import { wrapToolsWithStamping } from './stamp-middleware';

// Ensure the tool registry is populated. Safe to call multiple times —
// registerLocusTools is guarded by a `registered` flag.
registerLocusTools();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Load the workflow_run row or return null. */
async function getWorkflowRun(runId: string) {
  const [row] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId))
    .limit(1);
  return row ?? null;
}

/** Load the workflow document row or return null. */
async function getWorkflowDoc(documentId: string) {
  const [row] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  return row ?? null;
}

// Every AgentEvent type maps 1:1 onto a workflowEventTypeEnum value.
// AgentEvent union: turn_start | llm_delta | reasoning | tool_start |
//                   tool_result | turn_complete
// workflowEventTypeEnum adds `run_error` and `run_complete` which are
// emitted by the runner itself, not by the agent harness.
type WorkflowEventType =
  | 'turn_start'
  | 'llm_delta'
  | 'tool_start'
  | 'tool_result'
  | 'reasoning'
  | 'turn_complete'
  | 'run_error'
  | 'run_complete';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Execute a workflow run to completion. Designed to be called inside
 * `waitUntil()` at the route layer (Task 6) so it runs after the HTTP
 * response is sent. Returns when the run reaches a terminal state
 * (completed | failed | cancelled).
 *
 * @throws if the runId does not exist in the DB (programming error —
 *         the route should only call this after creating the run row).
 */
export async function runWorkflow(runId: string): Promise<void> {
  // ---- Load run + workflow doc ------------------------------------------
  const run = await getWorkflowRun(runId);
  if (!run) throw new Error(`runWorkflow: run ${runId} not found`);

  // Pre-execution cancellation check — the run may have been cancelled
  // between insertion and this function being invoked (e.g. user cancelled
  // immediately after triggering).
  if (run.status === 'cancelled') {
    // Already cancelled — nothing to do. The run row is already terminal.
    return;
  }

  const workflowDoc = await getWorkflowDoc(run.workflowDocumentId);
  if (!workflowDoc) {
    // Emit a run_error event before marking failed so the run view's event
    // log has a record of why the run aborted — otherwise post-mortem
    // debugging has to fall back to workflow_runs.error_message alone.
    // Matches the shape used by the triggering-user-missing path below.
    const message = `Workflow document ${run.workflowDocumentId} not found`;
    await insertEvent(runId, 0, 'run_error', {
      reason: 'workflow_doc_missing',
      message,
    });
    await markFailed(runId, message);
    return;
  }

  // Parse + validate the workflow frontmatter stored in documents.metadata.
  // The metadata jsonb column holds the authored workflow fields. `type` is
  // NOT mirrored into metadata — it's denormalised into the `documents.type`
  // column by the PATCH/POST sync blocks (see
  // src/app/api/brain/documents/[id]/route.ts). Inject it here so the
  // type-requiring validator passes; the trigger route has already
  // established `documents.type === 'workflow'` before creating this run.
  const fmResult = validateWorkflowFrontmatter({
    ...((workflowDoc.metadata as Record<string, unknown> | null) ?? {}),
    type: 'workflow',
  });
  if (!fmResult.ok) {
    const msg = `Invalid workflow frontmatter: ${fmResult.errors.map((e) => `${e.field} ${e.message}`).join(', ')}`;
    await insertEvent(runId, 0, 'run_error', {
      reason: 'invalid_frontmatter',
      message: msg,
    });
    await markFailed(runId, msg);
    return;
  }
  const frontmatter = fmResult.value;
  const workflowDocRef = workflowDoc.path;

  // ---- Resolve the triggering user's role --------------------------------
  // The runner acts as a platform_agent on behalf of the user who triggered
  // the run — the permission evaluator (Task 1) gates write tools on
  // actor.role, so the runner MUST pass through the real role rather than a
  // hardcoded value. Without this, any user (including viewers) could
  // escalate to editor by triggering a workflow that calls write tools.
  //
  // Future hardening: a `triggered_by_role` snapshot column on workflow_runs
  // would freeze the role at trigger time so role changes between trigger
  // and execution can't affect an already-running workflow. For MVP, live
  // lookup is acceptable — the trigger route rejects viewers up-front so
  // this live lookup only observes editor/admin/owner.
  const [triggeringUser] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, run.triggeredBy))
    .limit(1);

  if (!triggeringUser) {
    // Triggering user was deleted between insert and execution. Emit a
    // run_error and mark failed — this is the only path where the run
    // can't proceed at all.
    await insertEvent(runId, 0, 'run_error', { reason: 'triggering_user_missing' });
    await markFailed(runId, 'Triggering user not found');
    return;
  }

  // users.role is nullable in the schema (defaults to 'viewer' on insert).
  // Treat a null column value as 'viewer' — the most restrictive fallback,
  // consistent with the column default. The trigger route already rejects
  // viewer-role callers up front, so in normal flow this path only observes
  // editor/admin/owner; the fallback exists for data-drift safety.
  const triggeringRole = triggeringUser.role ?? 'viewer';

  // ---- Build context objects -------------------------------------------
  // The runner acts as a platform_agent on behalf of the user who triggered
  // the run. We give it write scope so the stamp middleware can call the
  // write tools (create_document / update_document). Role comes from the
  // DB lookup above — Task 1's evaluator gates write tools on role.
  const toolContext = {
    actor: {
      type: 'platform_agent' as const,
      id: run.triggeredBy,
      scopes: ['read', 'write'],
      role: triggeringRole,
    },
    companyId: workflowDoc.companyId,
    brainId: workflowDoc.brainId,
    grantedCapabilities: ['web'],
    webCallsThisTurn: 0,
  };

  const agentContext = {
    actor: {
      type: 'platform_agent' as const,
      userId: run.triggeredBy,
      companyId: workflowDoc.companyId,
      scopes: ['read', 'write'],
    },
    brainId: workflowDoc.brainId,
    companyId: workflowDoc.companyId,
    sessionId: null,
    abortSignal: new AbortController().signal,
    grantedCapabilities: ['web'],
  };

  // ---- Build the tool set with stamp middleware -------------------------
  const baseTools = buildToolSet(toolContext);
  const tools = wrapToolsWithStamping(
    baseTools,
    { runId, workflowDocRef },
    toolContext,
  );

  // ---- Build the system prompt ----------------------------------------
  // Load brain + folders for the base prompt. Degrade gracefully if rows
  // are missing (brain deleted mid-run is an edge case).
  const [brainRow] = await db
    .select({ id: brains.id, name: brains.name, slug: brains.slug })
    .from(brains)
    .where(eq(brains.id, workflowDoc.brainId))
    .limit(1);

  const [companyRow] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, workflowDoc.companyId))
    .limit(1);

  const folderRows = await db
    .select({ slug: folders.slug, name: folders.name, description: folders.description })
    .from(folders)
    .where(eq(folders.brainId, workflowDoc.brainId));

  const baseSystemPrompt = buildSystemPrompt({
    brain: brainRow ?? { name: 'Brain', slug: 'brain' },
    companyName: companyRow?.name ?? 'your company',
    folders: folderRows,
  });

  const system = buildWorkflowSystemPrompt(
    baseSystemPrompt,
    frontmatter,
    workflowDocRef,
  );

  // The workflow body (everything after the frontmatter) is the user
  // instruction. The whole document content serves as the prompt.
  const messages = [
    { role: 'user' as const, content: workflowDoc.content },
  ];

  // ---- Execute ---------------------------------------------------------
  let sequence = 0;
  let totalIn = 0;
  let totalOut = 0;

  try {
    await markRunning(runId);

    // Re-check cancellation after markRunning — a race between the trigger
    // and the actual start is possible. Mirror the in-loop turn_start path:
    // emit run_error AND call markCancelled so the row lands in a terminal
    // state (otherwise it stays 'running' until the zombie sweeper).
    const statusAfterStart = await getRunStatus(runId);
    if (statusAfterStart === 'cancelled') {
      await insertEvent(runId, sequence++, 'run_error', { reason: 'cancelled' });
      await markCancelled(runId);
      return;
    }

    const { events } = await runAgentTurn({
      ctx: agentContext,
      system,
      messages,
      tools,
      maxSteps: 40,
    });

    for await (const ev of events) {
      // Cancellation check at turn boundaries only — per spec Section 6.
      // Do NOT add mid-tool-call cancellation here.
      if (ev.type === 'turn_start') {
        const currentStatus = await getRunStatus(runId);
        if (currentStatus === 'cancelled') {
          await insertEvent(runId, sequence++, 'run_error', { reason: 'cancelled' });
          await markCancelled(runId);
          return;
        }
      }

      const eventType = ev.type as WorkflowEventType;

      // Build a plain payload from the event — strip the `type` field
      // since it's already stored in the eventType column.
      const { type: _type, ...rest } = ev;
      await insertEvent(runId, sequence++, eventType, rest as Record<string, unknown>);

      if (ev.type === 'turn_complete') {
        totalIn += ev.usage?.inputTokens ?? 0;
        totalOut += ev.usage?.outputTokens ?? 0;

        // Terminal finishReason handling. Order matters: check specific
        // terminal states first, then fall through to normal accumulation.
        //   - 'error'  → LLM stream-level error (onError fired). The run
        //                cannot complete normally.
        //   - 'denied' → a SessionStart or UserPromptSubmit hook denied
        //                the turn. No hook registers a deny today, but
        //                the hook bus is public and workflows are a
        //                long-lived execution surface — closing the gap
        //                now avoids silent "completed with 0 tokens" runs
        //                when a handler is added later.
        if (ev.finishReason === 'error') {
          await insertEvent(runId, sequence++, 'run_error', {
            message: 'LLM stream finished with error',
            finishReason: ev.finishReason,
          });
          await markFailed(runId, 'LLM stream finished with error');
          return;
        }
        if (ev.finishReason === 'denied') {
          await insertEvent(runId, sequence++, 'run_error', {
            reason: 'denied',
            finishReason: ev.finishReason,
          });
          await markFailed(runId, 'Agent turn denied by hook');
          return;
        }
      }
    }

    await insertEvent(runId, sequence++, 'run_complete', {});
    await markCompleted(runId, {
      summary: null,
      inputTokens: totalIn,
      outputTokens: totalOut,
    });
  } catch (err) {
    // Unwrap the cause chain. The AI SDK's NoOutputGeneratedError has a
    // generic `.message` ("No output generated. Check the stream for errors.")
    // and stashes the upstream provider error in `.cause`. Without walking
    // the chain we lose the actual reason (auth, 4xx payload, etc.) and the
    // run_error event is useless for post-mortem.
    const chain = flattenErrorChain(err);
    const message = chain.join(' | caused by: ');
    console.error('[workflow/run] run failed', err);
    try {
      await insertEvent(runId, sequence++, 'run_error', {
        message,
        causes: chain,
      });
    } catch {
      // insertEvent itself failing (e.g. DB down) should not mask the original error.
    }
    await markFailed(runId, message);
  }
}

/**
 * Walk an error's `.cause` chain into a flat array of strings. Stops at
 * depth 5 defensively in case something self-references. Used by the
 * runner to record the full upstream reason on run_error rather than
 * just the outermost `err.message` (which is often a generic wrapper
 * from the AI SDK).
 */
function flattenErrorChain(err: unknown): string[] {
  const out: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof Error) {
      out.push(cur.message || cur.name);
      cur = (cur as Error & { cause?: unknown }).cause;
    } else {
      out.push(String(cur));
      break;
    }
  }
  return out;
}

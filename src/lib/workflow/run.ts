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
    await markFailed(runId, `Workflow document ${run.workflowDocumentId} not found`);
    return;
  }

  // Parse + validate the workflow frontmatter stored in documents.metadata.
  // The metadata jsonb column holds the authored workflow fields.
  const fmResult = validateWorkflowFrontmatter(workflowDoc.metadata);
  if (!fmResult.ok) {
    const msg = `Invalid workflow frontmatter: ${fmResult.errors.map((e) => `${e.field} ${e.message}`).join(', ')}`;
    await markFailed(runId, msg);
    return;
  }
  const frontmatter = fmResult.value;
  const workflowDocRef = workflowDoc.path;

  // ---- Build context objects -------------------------------------------
  // The runner acts as a platform_agent on behalf of the user who triggered
  // the run. We give it write scope so the stamp middleware can call the
  // write tools (create_document / update_document).
  const toolContext = {
    actor: {
      type: 'platform_agent' as const,
      id: run.triggeredBy,
      scopes: ['read', 'write'],
      role: 'editor' as const,
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
    // and the actual start is possible.
    const statusAfterStart = await getRunStatus(runId);
    if (statusAfterStart === 'cancelled') {
      await insertEvent(runId, sequence++, 'run_error', { reason: 'cancelled' });
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

      // Map AgentEvent types to workflowEventTypeEnum values.
      // AgentEvent union: turn_start | llm_delta | reasoning | tool_start |
      //                   tool_result | turn_complete
      // workflowEventTypeEnum: turn_start | llm_delta | tool_start |
      //                        tool_result | reasoning | turn_complete |
      //                        run_error | run_complete
      // All AgentEvent types map 1:1 to workflow event types.
      type WorkflowEventType =
        | 'turn_start' | 'llm_delta' | 'tool_start' | 'tool_result'
        | 'reasoning' | 'turn_complete' | 'run_error' | 'run_complete';

      const eventType = ev.type as WorkflowEventType;

      // Build a plain payload from the event — strip the `type` field
      // since it's already stored in the eventType column.
      const { type: _type, ...rest } = ev;
      await insertEvent(runId, sequence++, eventType, rest as Record<string, unknown>);

      if (ev.type === 'turn_complete') {
        totalIn += ev.usage?.inputTokens ?? 0;
        totalOut += ev.usage?.outputTokens ?? 0;

        // If the LLM stream errored, finishReason is 'error'. Treat as a
        // run failure — the model didn't complete normally.
        if (ev.finishReason === 'error') {
          await insertEvent(runId, sequence++, 'run_error', {
            message: 'LLM stream finished with error',
            finishReason: ev.finishReason,
          });
          await markFailed(runId, 'LLM stream finished with error');
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
    const message = err instanceof Error ? err.message : String(err);
    try {
      await insertEvent(runId, sequence++, 'run_error', { message });
    } catch {
      // insertEvent itself failing (e.g. DB down) should not mask the original error.
    }
    await markFailed(runId, message);
  }
}

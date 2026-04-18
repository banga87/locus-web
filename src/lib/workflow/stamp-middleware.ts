// Stamp middleware — wraps write tools in a workflow run context so they
// stamp provenance into documents.metadata and track output document IDs.
//
// Architecture: option (c) — extend ToolContext with workflowRunContext.
// The write tools (create_document, update_document) read this field inside
// their own DB transactions and merge the stamp into documents.metadata.
// This keeps stamps atomic with the document write and avoids polluting the
// user-facing input schema (which has additionalProperties: false).
//
// The middleware's remaining job:
//   1. Clone the ToolContext with workflowRunContext injected.
//   2. For create_document / update_document: intercept the execute function
//      to extract the returned documentId and append it to
//      workflow_runs.output_document_ids after success.
//   3. All other tools: pass through unmodified.

import { dynamicTool } from 'ai';
import type { Tool } from 'ai';
import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { bridgeLocusTool } from '@/lib/agent/tool-bridge';
import { createDocumentTool } from '@/lib/tools/implementations/create-document';
import { updateDocumentTool } from '@/lib/tools/implementations/update-document';
import type { ToolContext } from '@/lib/tools/types';

/** The workflow context injected into every tool call for a run. */
export interface WorkflowRunContext {
  runId: string;
  workflowDocRef: string;
}

/** Names of tools that write documents and need stamp + output tracking. */
const WRITE_TOOL_NAMES = new Set(['create_document', 'update_document']);

/**
 * Append a documentId to workflow_runs.output_document_ids, skipping
 * duplicates. Uses a CASE expression so the append is a single UPDATE —
 * no read-then-write race.
 *
 * Single-writer invariant: only the runner for this runId ever calls this.
 * Fire-and-forget from the stamp middleware by design — the events log is
 * the authoritative record of what tools ran. If this write fails, the
 * output_document_ids array may be incomplete; reconciliation from the
 * events log is a Phase 2 concern (autonomous-loop replay tooling).
 *
 * Exported for test access.
 */
export async function appendOutputDocumentId(
  runId: string,
  documentId: string,
): Promise<void> {
  // Parameterised UUID — Drizzle serialises both `documentId` and `runId`
  // as bound parameters. No string interpolation of user-controlled values
  // into SQL. `array_append` is used in the ELSE branch; the CASE handles
  // deduplication without requiring DISTINCT/unnest round-trips.
  //
  // updated_at MUST be bumped on every workflow_runs write — the zombie
  // sweeper (Task 6) reads it to detect stuck runs. See the JSDoc on
  // workflow_runs.updatedAt.
  const docId = sql`${documentId}::uuid`;
  await db.execute(sql`
    UPDATE workflow_runs
    SET output_document_ids = CASE
      WHEN ${docId} = ANY(output_document_ids) THEN output_document_ids
      ELSE array_append(output_document_ids, ${docId})
    END,
    updated_at = now()
    WHERE id = ${runId}::uuid
  `);
}

/**
 * Wrap a tool set so that write tools (create_document, update_document)
 * stamp workflow provenance into documents.metadata and track their output
 * document IDs on the run row.
 *
 * Non-write tools are returned unchanged — their reference is preserved
 * so callers can use `===` identity checks for pass-through tools.
 *
 * @param tools         AI SDK tool set as returned by buildToolSet.
 * @param wfCtx         Workflow run context (runId + workflowDocRef).
 * @param toolContext   The ToolContext used when bridging the tools. The
 *                      middleware derives a stamped context from this.
 */
export function wrapToolsWithStamping(
  tools: Record<string, Tool>,
  wfCtx: WorkflowRunContext,
  toolContext: ToolContext,
): Record<string, Tool> {
  // Build a context with workflowRunContext injected — used when re-bridging
  // write tools so the stamp flows through ToolContext into the DB write.
  const stampedContext: ToolContext = {
    ...toolContext,
    workflowRunContext: {
      runId: wfCtx.runId,
      workflowDocRef: wfCtx.workflowDocRef,
    },
  };

  const result: Record<string, Tool> = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!WRITE_TOOL_NAMES.has(name)) {
      // Non-write tool: pass through by reference (identity preserved).
      result[name] = tool;
      continue;
    }

    // Write tool: re-bridge with the stamped context, then wrap execute to
    // track the returned documentId.
    const locusTool =
      name === 'create_document' ? createDocumentTool : updateDocumentTool;
    const stamped = bridgeLocusTool(locusTool, stampedContext);

    result[name] = dynamicTool({
      description: stamped.description,
      // Pass the already-wrapped schema straight through. `stamped.inputSchema`
      // is the FlexibleSchema returned by `jsonSchema()` inside bridgeLocusTool;
      // calling `jsonSchema()` on it again double-wraps it, burying `type:
      // 'object'` two levels deep. Anthropic's adapter then sends the outer
      // wrapper as `input_schema` and the API rejects with
      // "tools.N.custom.input_schema.type: Field required".
      inputSchema: stamped.inputSchema,
      execute: async (args, options) => {
        const output = await stamped.execute!(args, options);

        // On success the tool returns { documentId, path, title, version }.
        // On error it returns { error: true, code, message, hint }.
        const maybeDocId = (output as { documentId?: string }).documentId;
        if (maybeDocId) {
          // Fire-and-forget is intentional here: the append is best-effort.
          // If it fails, the run still completes; the output_document_ids
          // array may be incomplete but that's recoverable from the events log.
          appendOutputDocumentId(wfCtx.runId, maybeDocId).catch((err) => {
            console.error(
              '[stamp-middleware] appendOutputDocumentId failed',
              { runId: wfCtx.runId, documentId: maybeDocId, error: String(err) },
            );
          });
        }

        return output;
      },
    });
  }

  return result;
}

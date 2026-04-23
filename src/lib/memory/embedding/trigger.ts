// triggerEmbeddingFor — fire-and-forget workflow enqueue.
//
// Uses the Vercel Workflow SDK's `start(workflowFn, argsArray)` API
// (not `trigger`). The real SDK signature is:
//   start<TArgs, TResult>(workflow, args: TArgs[], options?) => Promise<Run<TResult>>
//
// We pass the EmbedJobArgs as the sole element of the args array so
// the runtime delivers it as the first argument to embedDocumentWorkflow.
// We await only the enqueue acknowledgement (the Run handle), not the
// completion of the workflow itself — true fire-and-forget from the
// caller's perspective.
//
// Public signature is load-bearing — Task 11 + 12 call this unchanged.

import { start } from 'workflow';
import { embedDocumentWorkflow } from './workflow';
import type { EmbedJobArgs } from './types';

export async function triggerEmbeddingFor(args: EmbedJobArgs): Promise<void> {
  await start(embedDocumentWorkflow, [args]);
}

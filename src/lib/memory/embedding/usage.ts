// Thin wrapper over recordUsage that knows the embedding model id and
// fills the right shape. Called from embedDocumentWorkflow's
// recordUsage step. Per ADR-003, customer cost = provider cost +
// MARKUP — `recordUsage` handles that calculation.
//
// Harness-pure — imports only @/lib/usage which is also harness-pure.

import { recordUsage } from '@/lib/usage/record';
import { EMBEDDING_MODEL_ID } from './types';

export interface RecordEmbeddingUsageArgs {
  companyId: string;
  brainId: string;
  documentId: string;
  promptTokens: number;
}

export async function recordEmbeddingUsage(
  args: RecordEmbeddingUsageArgs,
): Promise<{ id: string } | null> {
  return recordUsage({
    companyId: args.companyId,
    sessionId: null,
    userId: null,
    modelId: `openai/${EMBEDDING_MODEL_ID}`,
    inputTokens: args.promptTokens,
    outputTokens: 0,
    totalTokens: args.promptTokens,
    source: 'embedding_worker',
    parentUsageRecordId: null,
  });
}

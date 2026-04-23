// src/lib/memory/embedding/workflow.ts
//
// embedDocumentWorkflow — the durable workflow that generates and
// persists a document's embedding. Triggered fire-and-forget from the
// write pipeline (POST + PATCH route handlers) and from the backfill
// CLI. Each 'use step' is independently retried by the Workflow
// runtime; the whole workflow is idempotent (re-runs overwrite the
// same row).
//
// Harness-pure — imports only @/db, drizzle, the embedding subsystem,
// and the usage helper. The 'workflow' SDK is platform-agnostic.
//
// Trust boundary: the route handler that calls triggerEmbeddingFor is
// the auth gate. The tenant-scoped (id, companyId, brainId) WHEREs
// inside loadDoc / persistEmbedding are defense-in-depth.

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { openaiEmbedder } from './openai';
import { recordEmbeddingUsage } from './usage';
import type { EmbedJobArgs } from './types';

export async function embedDocumentWorkflow(args: EmbedJobArgs): Promise<void> {
  'use workflow';

  const doc = await loadDoc(args);
  if (!doc) return;                                       // tuple mismatch / not found
  if (doc.deletedAt) return;                              // soft-deleted between trigger and run
  if (!doc.content || doc.content.trim().length === 0) return;

  const result = await generateEmbedding(doc.content);
  await persistEmbedding(args, result.vector);
  await recordUsage(args, result.promptTokens);
}

async function loadDoc(args: EmbedJobArgs) {
  'use step';
  const [row] = await db
    .select({
      content: documents.content,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, args.documentId),
        eq(documents.companyId, args.companyId),
        eq(documents.brainId, args.brainId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function generateEmbedding(content: string) {
  'use step';
  return openaiEmbedder.embed(content);
}

async function persistEmbedding(args: EmbedJobArgs, vector: number[]) {
  'use step';
  await db
    .update(documents)
    .set({ embedding: vector })
    .where(
      and(
        eq(documents.id, args.documentId),
        eq(documents.companyId, args.companyId),
        eq(documents.brainId, args.brainId),
      ),
    );
}

async function recordUsage(args: EmbedJobArgs, promptTokens: number) {
  'use step';
  await recordEmbeddingUsage({
    companyId: args.companyId,
    brainId: args.brainId,
    documentId: args.documentId,
    promptTokens,
  });
}

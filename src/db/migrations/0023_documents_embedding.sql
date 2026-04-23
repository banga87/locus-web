-- Adds embedding: 1536-dim vector for OpenAI text-embedding-3-small
-- (Phase 2). Populated asynchronously by the embedDocumentWorkflow
-- (src/lib/memory/embedding/workflow.ts) — column is nullable so writes
-- never block on the embedding API. HNSW index supports the cosine
-- similarity fused into retrieve() (src/lib/memory/core.ts).
-- See docs/superpowers/specs/2026-04-23-phase2-pgvector-hybrid-fusion-design.md.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents USING hnsw (embedding vector_cosine_ops);

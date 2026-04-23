-- Adds compact_index: a rule-based structured summary of every document
-- used by search_documents scan mode to surface ~40-token hits before
-- the agent fetches full content. Populated on every write by
-- src/lib/memory/compact-index/extract.ts. Always-on, zero LLM cost.
-- See docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS compact_index jsonb;

-- GIN indexes on the fields agents filter by in retrieval.
CREATE INDEX IF NOT EXISTS documents_compact_index_entities_idx
  ON documents USING gin ((compact_index -> 'entities'));

CREATE INDEX IF NOT EXISTS documents_compact_index_topics_idx
  ON documents USING gin ((compact_index -> 'topics'));

CREATE INDEX IF NOT EXISTS documents_compact_index_flags_idx
  ON documents USING gin ((compact_index -> 'flags'));

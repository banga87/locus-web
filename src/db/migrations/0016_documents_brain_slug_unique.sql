-- Migration 0016: partial unique index on documents(brain_id, slug)
-- for live (non-deleted) rows.
--
-- Problem: previously the only DB-level uniqueness on documents was
-- the partial unique `documents_company_scaffolding_unique` (one
-- scaffolding doc per company). There was NO constraint preventing
-- two live documents from sharing a (brain_id, slug) pair — which
-- also means two live docs at the same `path` (since path is
-- derived as `{folder_slug}/{doc_slug}`).
--
-- The `create_document` tool runs a proactive SELECT to return
-- PATH_TAKEN but that has a TOCTOU window — two concurrent calls
-- could both pass the SELECT and both insert. This index closes
-- that race at the storage layer.
--
-- Scope: partial index on `deleted_at IS NULL`. Soft-deleted docs
-- don't block reuse of their slug — matches the existing semantics
-- of the path-lookup queries (get_document / search_documents both
-- filter on `deleted_at IS NULL`).
--
-- Safety check before applying: verified zero duplicate (brain_id,
-- slug) pairs exist in production (both live and including
-- soft-deleted). Migration is non-destructive — no cleanup needed.

CREATE UNIQUE INDEX IF NOT EXISTS documents_brain_slug_live_unique
  ON documents (brain_id, slug)
  WHERE deleted_at IS NULL;

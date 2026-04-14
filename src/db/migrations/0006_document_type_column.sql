-- Migration 0006: add denormalised documents.type column (Phase 1.5 Task 1).
--
-- Document type lives in YAML frontmatter embedded in `documents.content`.
-- Parsing it on every read is unindexable; this migration lifts it into
-- a dedicated column so manifest rebuilds, agent-scaffolding lookups and
-- skill compilation all hit a btree instead of a table scan.
--
-- Frontmatter → type sync happens in application code on write (see
-- `src/lib/brain/save.ts` + the two brain document route handlers).
-- We deliberately do NOT install a plpgsql trigger: keeping the parse
-- in TypeScript means one canonical YAML parser, testable as a pure
-- function, and no duplicated parser in plpgsql.
--
-- The column is nullable so existing rows validate without backfill.
-- `scripts/backfill-document-type.ts` then populates historical rows.
--
-- Idempotent guards (IF NOT EXISTS / DO blocks) so re-running via
-- `scripts/apply-custom-migrations.ts` is safe.

-- --------------------------------------------------------------------
-- Denormalised `type` column.
-- --------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "documents" ADD COLUMN "type" text;
EXCEPTION WHEN duplicate_column THEN null; END $$;
--> statement-breakpoint

-- --------------------------------------------------------------------
-- Partial unique index — at most one agent-scaffolding doc per company.
--
-- Phase 1.5 enforces "exactly one scaffolding per company" at the DB
-- layer (design spec §Data Model). Other type values are unconstrained.
-- --------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "documents_company_scaffolding_unique"
  ON "documents" ("company_id")
  WHERE "type" = 'agent-scaffolding';
--> statement-breakpoint

-- --------------------------------------------------------------------
-- Composite btree for manifest-rebuild queries.
--
-- "SELECT ... FROM documents WHERE company_id = $1 AND type = 'skill'"
-- is the hot path for skill-manifest regeneration. This index keeps
-- that lookup O(log n) as companies accumulate skills.
-- --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "documents_company_type_idx"
  ON "documents" ("company_id", "type");

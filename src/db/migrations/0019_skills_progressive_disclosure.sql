-- Migration 0019: Skills progressive-disclosure foundation.
--
-- Extends `documents` with two nullable columns so a root skill doc
-- (type='skill') can own a tree of nested file rows (type='skill-resource').
-- Drops the old per-company `skill_manifests` cache — the new runtime does
-- not pre-compile manifests; it reads per-agent visibility live from
-- `documents` on system-prompt build.
--
-- Safe on a re-run via IF NOT EXISTS / IF EXISTS guards.

-- --------------------------------------------------------------------
-- Nested-file addressing.
-- --------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "documents"
    ADD COLUMN "parent_skill_id" uuid
      REFERENCES "documents"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "documents" ADD COLUMN "relative_path" text;
EXCEPTION WHEN duplicate_column THEN null; END $$;
--> statement-breakpoint

-- Identity for skill-resource rows: (parent_skill_id, relative_path) is
-- unique. Partial so brain docs (parent_skill_id IS NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "documents_skill_resource_path"
  ON "documents" ("parent_skill_id", "relative_path")
  WHERE "parent_skill_id" IS NOT NULL;
--> statement-breakpoint

-- --------------------------------------------------------------------
-- Retire the manifest cache.
-- --------------------------------------------------------------------
DROP TABLE IF EXISTS "skill_manifests";

-- 0020: Add parent_usage_record_id to usage_records for subagent attribution.
--
-- Rationale (2026-04-19 subagent harness spec §7): the Platform Agent can
-- invoke child subagents that each make their own LLM calls. To attribute
-- a full conversational turn's token spend we need a self-referencing link
-- from child usage_records back to the parent (top-level) row. NULL means
-- the row IS a top-level call.
--
-- The FK is declared in raw SQL rather than Drizzle's `.references()` to
-- avoid a type cycle on the self-reference. ON DELETE SET NULL keeps child
-- rows queryable as orphans if the parent is ever purged.
--
-- Idempotent via IF NOT EXISTS / duplicate_object guards for safe re-runs.

ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS parent_usage_record_id uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE usage_records
    ADD CONSTRAINT usage_records_parent_usage_record_id_fk
    FOREIGN KEY (parent_usage_record_id) REFERENCES usage_records(id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS usage_records_parent_usage_record_id_idx
  ON usage_records (parent_usage_record_id)
  WHERE parent_usage_record_id IS NOT NULL;

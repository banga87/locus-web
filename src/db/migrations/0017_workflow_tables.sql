-- Migration 0017: workflow_runs + workflow_run_events tables.
--
-- Schema hand-written to match src/db/schema/workflow-runs.ts and
-- src/db/schema/workflow-run-events.ts. drizzle-kit generate was skipped
-- because the meta/_journal.json is out of sync with the SQL files on this
-- branch (only 3 journal entries vs 17 SQL files) — the non-TTY environment
-- blocks drizzle-kit's interactive reconciliation prompt.
--
-- Applied via Supabase MCP (mcp__plugin_supabase_supabase__apply_migration)
-- on project `locus` (wvobnayfskzegvrniomq).

-- Enums ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "public"."triggered_by_kind" AS ENUM('manual', 'schedule');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."workflow_run_status" AS ENUM(
    'queued', 'running', 'completed', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."workflow_event_type" AS ENUM(
    'turn_start', 'llm_delta', 'tool_start', 'tool_result',
    'reasoning', 'turn_complete', 'run_error', 'run_complete'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Tables --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workflow_document_id"  uuid NOT NULL,
  "triggered_by"          uuid NOT NULL,
  "triggered_by_kind"     "triggered_by_kind" DEFAULT 'manual' NOT NULL,
  "status"                "workflow_run_status" DEFAULT 'running' NOT NULL,
  "started_at"            timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at"          timestamp with time zone,
  "output_document_ids"   uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "summary"               text,
  "error_message"         text,
  "total_input_tokens"    integer DEFAULT 0 NOT NULL,
  "total_output_tokens"   integer DEFAULT 0 NOT NULL,
  "total_cost_usd"        numeric(12, 6) DEFAULT '0' NOT NULL,
  "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"            timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_run_events" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id"      uuid NOT NULL,
  "sequence"    integer NOT NULL,
  "event_type"  "workflow_event_type" NOT NULL,
  "payload"     jsonb DEFAULT '{}' NOT NULL,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Foreign keys --------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE "workflow_runs"
    ADD CONSTRAINT "workflow_runs_workflow_document_id_documents_id_fk"
    FOREIGN KEY ("workflow_document_id") REFERENCES "public"."documents"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "workflow_runs"
    ADD CONSTRAINT "workflow_runs_triggered_by_users_id_fk"
    FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "workflow_run_events"
    ADD CONSTRAINT "workflow_run_events_run_id_workflow_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Indexes -------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "workflow_runs_doc_started_idx"
  ON "workflow_runs" USING btree ("workflow_document_id", "started_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workflow_runs_user_started_idx"
  ON "workflow_runs" USING btree ("triggered_by", "started_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "workflow_run_events_run_seq_idx"
  ON "workflow_run_events" USING btree ("run_id", "sequence");

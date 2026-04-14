-- Migration 0007: Phase 1.5 ingestion + agents tables (Task 1).
--
-- Adds three pieces:
--   1. Session context-injection columns (`agent_definition_id`,
--      `scaffolding_cache`, `scaffolding_cache_version`) on the existing
--      `sessions` table. The cache + version let SessionStart skip the
--      scaffolding re-injection on every turn; it only rebuilds when
--      the user bumps the scaffolding doc's `version` frontmatter.
--   2. `skill_manifests` — one-row-per-company JSON cache for the
--      compiled skill manifest. Rebuilt on every skill-doc write.
--   3. `session_attachments` — user-uploaded files and pasted-text
--      blobs that flow through the ingestion state machine
--      (uploaded → extracted → committed | discarded).
--
-- RLS: both new tables get ENABLE RLS + a single company-isolation
-- policy using the same `get_user_company_id()` helper that migration
-- 0003 introduced. This keeps the policy surface uniform across the
-- codebase — any deviation makes the policy harder to audit.
--
-- Idempotent guards (IF NOT EXISTS / DO blocks) so re-running via
-- `scripts/apply-custom-migrations.ts` is safe.

-- --------------------------------------------------------------------
-- 1. Extend `sessions` for Phase 1.5 context injection.
--
-- `agent_definition_id` NULLs out on agent-definition-doc delete so the
-- session survives (it falls back to the default Platform Agent). It
-- references `documents(id)` because agents are documents in Phase 1.5.
-- --------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "sessions" ADD COLUMN "agent_definition_id" uuid;
EXCEPTION WHEN duplicate_column THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_agent_definition_id_documents_id_fk"
    FOREIGN KEY ("agent_definition_id") REFERENCES "public"."documents"("id")
    ON DELETE SET NULL ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sessions" ADD COLUMN "scaffolding_cache" jsonb;
EXCEPTION WHEN duplicate_column THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "sessions" ADD COLUMN "scaffolding_cache_version" integer;
EXCEPTION WHEN duplicate_column THEN null; END $$;
--> statement-breakpoint

-- --------------------------------------------------------------------
-- 2. `skill_manifests` — per-company compiled skill manifest cache.
--
-- PK on company_id: exactly one row per company. Rebuilds upsert.
-- ON DELETE CASCADE: purge manifest when company is deleted.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "skill_manifests" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"manifest" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "skill_manifests" ADD CONSTRAINT "skill_manifests_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- --------------------------------------------------------------------
-- 3. `session_attachments` — ingestion state machine rows.
--
-- CHECK constraints pin `kind` and `status` vocabularies rather than
-- using enum types, because the vocabulary is tightly coupled to the
-- TypeScript ingestion state machine — keeping it on the column as
-- a CHECK avoids pg_enum alter-type churn when the state machine grows.
--
-- `committed_doc_id` FK: SET NULL on doc delete so attachment history
-- survives even if the committed doc is archived/removed.
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "session_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text,
	"filename" text,
	"mime_type" text,
	"size_bytes" bigint,
	"extracted_text" text,
	"extraction_error" text,
	"status" text NOT NULL,
	"committed_doc_id" uuid,
	"injected_at_turn" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_attachments_kind_check"
	  CHECK ("kind" IN ('file', 'pasted-text')),
	CONSTRAINT "session_attachments_status_check"
	  CHECK ("status" IN ('uploaded', 'extracted', 'committed', 'discarded'))
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "session_attachments" ADD CONSTRAINT "session_attachments_session_id_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "session_attachments" ADD CONSTRAINT "session_attachments_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "session_attachments" ADD CONSTRAINT "session_attachments_committed_doc_id_documents_id_fk"
    FOREIGN KEY ("committed_doc_id") REFERENCES "public"."documents"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "session_attachments_session_id_idx"
  ON "session_attachments" USING btree ("session_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "session_attachments_status_idx"
  ON "session_attachments" USING btree ("company_id", "status");
--> statement-breakpoint

-- --------------------------------------------------------------------
-- Row-Level Security.
--
-- Uses the `get_user_company_id()` helper from migration 0003. The
-- plan in docs suggested an inline subquery, but the codebase-wide
-- pattern is the helper — deviating would fragment the policy surface
-- and make auditing harder.
--
-- `skill_manifests` is a service-managed cache: writes only ever
-- happen through the Drizzle service-role client (which bypasses RLS).
-- The auth-scoped client is narrowed to SELECT-only as defense-in-depth
-- so a leaked anon/auth JWT cannot mutate the manifest cache.
--
-- `session_attachments` keeps FOR ALL because user-driven inserts
-- (uploads, pasted text) flow through the auth-scoped client.
--
-- Idempotent: DROP IF EXISTS + CREATE so re-running is safe.
-- --------------------------------------------------------------------

ALTER TABLE "skill_manifests" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation" ON "skill_manifests";
CREATE POLICY "company_isolation" ON "skill_manifests"
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id());

ALTER TABLE "session_attachments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation" ON "session_attachments";
CREATE POLICY "company_isolation" ON "session_attachments"
  FOR ALL
  USING (company_id = get_user_company_id());

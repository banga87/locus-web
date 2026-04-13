-- Migration 0005: mcp_connections + pgcrypto + RLS (Phase 1 Task 3).
--
-- The schema portion is based on `npx drizzle-kit generate` output from
-- `src/db/schema/mcp-connections.ts`, then hand-wrapped in idempotent
-- guards (IF NOT EXISTS / DO $$...$$ duplicate_object catches) so
-- re-running via `scripts/apply-custom-migrations.ts` is safe.
--
-- The RLS block and the pgcrypto extension enable are hand-written per
-- the Phase 1 Task 3 plan (Steps 1-2). Drizzle-kit does not manage
-- extensions or RLS policies.
--
-- Credential storage: columns use the `bytea` type (Postgres') rather
-- than pgcrypto's PGP_SYM_ENCRYPT_BYTEA's opaque output. Helpers in
-- `src/lib/mcp-out/connections.ts` call pgp_sym_encrypt / pgp_sym_decrypt
-- at read and write time using a 32-byte hex key from the
-- MCP_CONNECTION_ENCRYPTION_KEY env var. Key rotation is a Phase 2
-- concern — for MVP the key is static.

-- --------------------------------------------------------------------
-- Extensions.
--
-- pgcrypto ships with Supabase but is not always pre-enabled in the
-- target DB; make it explicit. `IF NOT EXISTS` is idempotent.
-- --------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- --------------------------------------------------------------------
-- Enums + table.
-- --------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "public"."mcp_connection_auth_type" AS ENUM('none', 'bearer');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."mcp_connection_status" AS ENUM('active', 'disabled', 'error');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"server_url" text NOT NULL,
	"auth_type" "mcp_connection_auth_type" DEFAULT 'none' NOT NULL,
	"credentials_encrypted" "bytea",
	"status" "mcp_connection_status" DEFAULT 'active' NOT NULL,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mcp_connections_company_status_idx"
  ON "mcp_connections" USING btree ("company_id","status");
--> statement-breakpoint

-- --------------------------------------------------------------------
-- Row-Level Security policy.
--
-- Company isolation: any active member of the calling company can SELECT
-- rows. Mutation is additionally gated in the application layer (the
-- /api/admin/mcp-connections routes require Owner role), so this policy
-- does not enforce per-role restrictions.
--
-- The service role bypasses RLS (Supabase default), which is what the
-- `db` client uses server-side — application code is responsible for
-- scoping its own queries by company_id (which all helpers here do).
-- --------------------------------------------------------------------

ALTER TABLE "mcp_connections" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mcp_connections_company_isolation" ON "mcp_connections";
CREATE POLICY "mcp_connections_company_isolation" ON "mcp_connections"
  FOR ALL
  USING (company_id = get_user_company_id());

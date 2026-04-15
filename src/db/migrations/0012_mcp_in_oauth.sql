-- Migration 0012: MCP-IN OAuth tables (Task 1 of MCP-IN OAuth plan).
--
-- Adds four tables that back Locus's built-in OAuth 2.1 authorization
-- server for MCP-IN clients:
--   * oauth_clients         — Dynamic Client Registration (RFC 7591).
--                             Public clients only (no client_secret).
--   * oauth_sessions        — in-flight /authorize sessions (5-min TTL).
--   * oauth_codes           — one-time-use auth codes; only sha256(code)
--                             is stored (60-sec TTL).
--   * oauth_refresh_tokens  — rotated on every use; revoked_at set on
--                             rotation or explicit disconnect.
--
-- Also adds `audit_events.token_type` ('pat' | 'oauth' | null) so we can
-- distinguish PAT- vs OAuth-driven actor events without joining.
--
-- Hand-written (rather than `drizzle-kit generate`d) to stay consistent
-- with migrations 0005-0011 in this repo and to keep every statement
-- idempotent — IF NOT EXISTS / DO $$ duplicate_object guards make
-- re-running via `scripts/apply-custom-migrations.ts` safe.

-- --------------------------------------------------------------------
-- oauth_clients
--
-- client_id is a UUID issued at registration time. No client_secret —
-- MCP-IN is a public-client flow (PKCE-mandated). redirect_uris and
-- grant_types are text[] so a single client can register multiple
-- redirect URIs (loopback + custom scheme) without a join table.
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "oauth_clients" (
	"client_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"grant_types" text[] DEFAULT '{"authorization_code","refresh_token"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint

-- --------------------------------------------------------------------
-- oauth_sessions
--
-- session_ref is an opaque handle (not a UUID — we pick it ourselves so
-- it can be e.g. a base64url random). Cascade on client delete: if an
-- operator nukes a client registration, kill its pending sessions too.
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "oauth_sessions" (
	"session_ref" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "oauth_sessions" ADD CONSTRAINT "oauth_sessions_client_id_oauth_clients_client_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "oauth_sessions_expires_at_idx"
  ON "oauth_sessions" USING btree ("expires_at");
--> statement-breakpoint

-- --------------------------------------------------------------------
-- oauth_codes
--
-- The PK is the sha256 hex of the plaintext code — the code itself is
-- only ever held on the wire and in the client. Cascade on user or
-- company delete so we don't leave orphan codes; they'd be unusable
-- anyway (the token endpoint joins through user_id).
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_client_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- --------------------------------------------------------------------
-- oauth_refresh_tokens
--
-- token_hash = sha256(refresh_token). revoked_at is NULL for active
-- tokens; rotation sets it on the old row and inserts a fresh row.
-- Rotation-reuse detection (presenting a revoked token) chain-revokes
-- all rows with the same (user_id, client_id) — the composite index
-- keeps that sweep fast.
-- --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "oauth_refresh_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_client_id_oauth_clients_client_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "oauth_refresh_user_client_active_idx"
  ON "oauth_refresh_tokens" USING btree ("user_id","client_id");
--> statement-breakpoint

-- --------------------------------------------------------------------
-- audit_events.token_type
--
-- Nullable text — 'pat' | 'oauth' | NULL (for non-token actors like
-- user sessions and 'system'). Added as nullable with no default so
-- existing rows remain untagged; the column is populated going forward
-- by the audit emitter when token_id is non-null.
-- --------------------------------------------------------------------

ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "token_type" text;

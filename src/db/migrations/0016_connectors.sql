-- Migration 0016: Connectors page — adds OAuth authType, pending status,
-- and catalog_id column to mcp_connections.
--
-- ALTER TYPE ADD VALUE cannot run inside a transaction block, so each
-- enum addition is its own statement block. IF NOT EXISTS makes re-runs
-- safe under apply-custom-migrations.ts.

ALTER TYPE "mcp_connection_auth_type" ADD VALUE IF NOT EXISTS 'oauth';
--> statement-breakpoint

ALTER TYPE "mcp_connection_status" ADD VALUE IF NOT EXISTS 'pending';
--> statement-breakpoint

ALTER TABLE "mcp_connections" ADD COLUMN IF NOT EXISTS "catalog_id" text;

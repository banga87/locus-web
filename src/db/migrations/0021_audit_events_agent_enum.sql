-- 0021: Extend audit_event_category enum with 'agent'.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run OUTSIDE a transaction,
-- and the new value cannot be used in the same transaction it was added.
-- This migration ships ALONE; subsequent migrations / code referencing
-- 'agent' come in later deploys.
--
-- Idempotency: IF NOT EXISTS makes the migration safe to re-run against
-- a database where it's already been applied.

ALTER TYPE "audit_event_category" ADD VALUE IF NOT EXISTS 'agent';

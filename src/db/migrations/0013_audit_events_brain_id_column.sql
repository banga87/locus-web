-- 0013: Add brain_id column to audit_events for Realtime brain-scoped filtering.
--
-- Rationale (spec §7 Migration 1b): without brain_id, the Realtime channel
-- can only filter by company_id, which would broadcast every brain's
-- document-access metadata to all viewers in a multi-brain company. Adding
-- brain_id closes that disclosure vector.
--
-- NULL brain_id is permitted for events that aren't brain-scoped (authentication,
-- administration). Deletion policy: ON DELETE SET NULL preserves audit rows
-- after brain deletion.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS guards against re-runs.

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS brain_id uuid
    REFERENCES brains(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_brain_id
  ON audit_events (brain_id)
  WHERE brain_id IS NOT NULL;

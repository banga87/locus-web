-- 0014: Realtime publication + SELECT policy for audit_events.
--
-- Rationale (spec §7 Migration 2): Supabase Realtime evaluates the SELECT
-- policy per-subscriber per-INSERT. Without an explicit policy, Realtime
-- either delivers nothing or delivers everything. We must be explicit.
--
-- Policy semantics: the subscriber's company_id matches the event's company_id
-- AND either (a) the event has no brain_id (authentication/administration
-- events — readable by any member of the company) OR (b) the event's
-- brain_id belongs to the subscriber's company. "Brain membership" ==
-- "same company" today; when per-brain ACL ships (§13 open question 7),
-- tighten the policy via a brain_members join.
--
-- Idempotency: DROP IF EXISTS / IF NOT EXISTS guard re-runs.

-- Ensure the table is in the Realtime publication. ALTER PUBLICATION ... ADD TABLE
-- errors with duplicate_object if the table is already in the publication (which
-- Supabase sometimes adds automatically for RLS-enabled tables). Wrap in a DO block
-- that swallows that specific error so this migration file stays identical across
-- environments (dev / staging / prod) — no per-env edits needed.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE audit_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SELECT policy for authenticated subscribers.
DROP POLICY IF EXISTS audit_events_realtime_select ON audit_events;

CREATE POLICY audit_events_realtime_select ON audit_events
  FOR SELECT TO authenticated
  USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid())
    AND (
      brain_id IS NULL
      OR EXISTS (
        SELECT 1 FROM brains b
        WHERE b.id = audit_events.brain_id
          AND b.company_id = audit_events.company_id
      )
    )
  );

-- Migration 0009: Tighten `session_attachments` RLS to enforce the
-- session-owner boundary in addition to company isolation.
--
-- Migration 0007 created the `company_isolation` policy as a single
-- `company_id = get_user_company_id()` clause. The Phase 1.5 design
-- spec §Data Model requires the policy to be scoped to BOTH the
-- caller's company AND the session owner — chat history (and the
-- attachments hanging off it) is private per user even within the
-- same company. The original plan's verbatim SQL was incomplete; this
-- migration applies the spec's true intent.
--
-- Postgres RLS does not follow foreign keys, so the parent `sessions`
-- policy does NOT transitively constrain `session_attachments` — we
-- have to spell the session-owner check out explicitly. We do that
-- with a `session_id IN (SELECT id FROM sessions WHERE user_id =
-- auth.uid())` subquery, mirroring the pattern already used by the
-- `session_turns_via_session` policy in migration 0004.
--
-- 0007 has already been applied to the live dev DB with the wider
-- policy, and per-policy `qual` cannot be ALTERed in place, so this
-- migration drops and recreates the policy under a new name that
-- reflects the new boundary. Idempotent via DROP IF EXISTS.

DROP POLICY IF EXISTS "company_isolation" ON "session_attachments";
DROP POLICY IF EXISTS "company_and_session_owner_isolation" ON "session_attachments";

CREATE POLICY "company_and_session_owner_isolation" ON "session_attachments"
  FOR ALL TO authenticated
  USING (
    company_id = get_user_company_id()
    AND session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id = get_user_company_id()
    AND session_id IN (SELECT id FROM sessions WHERE user_id = auth.uid())
  );

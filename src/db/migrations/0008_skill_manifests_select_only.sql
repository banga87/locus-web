-- Migration 0008: Narrow `skill_manifests` RLS to SELECT-only.
--
-- Migration 0007 originally created the `company_isolation` policy on
-- `skill_manifests` as `FOR ALL`. The Phase 1.5 plan specified
-- `FOR SELECT TO authenticated` because `skill_manifests` is a
-- service-managed cache: all writes go through the Drizzle service-role
-- client (which bypasses RLS). The auth-scoped client only ever needs
-- to read the manifest, so we narrow the policy as defense-in-depth —
-- a leaked anon/auth JWT cannot mutate the manifest cache.
--
-- 0007 has already been applied to the live dev DB with the wider
-- `FOR ALL` policy, and per-policy `cmd` cannot be ALTERed in place,
-- so this migration drops and recreates the policy with the correct
-- scope. Idempotent via DROP IF EXISTS.
-- --------------------------------------------------------------------

DROP POLICY IF EXISTS "company_isolation" ON "skill_manifests";
CREATE POLICY "company_isolation" ON "skill_manifests"
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id());

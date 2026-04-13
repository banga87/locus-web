-- Migration 0003: Row-Level Security policies + immutability triggers.
--
-- References:
--   11-auth-and-access.md Section 3.3 (RLS policy mapping)
--   12-database-schema.md "Row-Level Security" section
--
-- Approach: every company-scoped table gets ENABLE RLS + a single
-- "company_isolation" policy that resolves the caller's company via a
-- SECURITY DEFINER helper function. The helper reads from the users
-- table using auth.uid() from the Supabase JWT — PgBouncer-safe because
-- it uses no session-level state (no set_config).
--
-- The service role bypasses RLS entirely (Supabase default), which is how
-- server-side maintenance, manifest generation, and audit writes work.
-- The application is responsible for explicitly scoping those queries
-- by company_id.

-- --------------------------------------------------------------------
-- Helper function: resolve the authenticated user's company_id.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_company_id()
RETURNS uuid AS $$
  SELECT company_id
  FROM users
  WHERE id = auth.uid()
    AND status = 'active'
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- --------------------------------------------------------------------
-- Company isolation policies.
--
-- Pattern per 11-auth-and-access.md: single FOR ALL policy using the
-- helper function. Role-based INSERT/DELETE restrictions are layered
-- on top for documents (editors write, admins delete).
-- --------------------------------------------------------------------

-- companies: users see only their own company row
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation" ON companies;
CREATE POLICY "company_isolation" ON companies
  FOR ALL
  USING (id = get_user_company_id());

-- brains
ALTER TABLE brains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation" ON brains;
CREATE POLICY "company_isolation" ON brains
  FOR ALL
  USING (company_id = get_user_company_id());

-- categories
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation" ON categories;
CREATE POLICY "company_isolation" ON categories
  FOR ALL
  USING (company_id = get_user_company_id());

-- documents: company isolation + role-gated INSERT/DELETE
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation" ON documents;
CREATE POLICY "company_isolation" ON documents
  FOR ALL
  USING (company_id = get_user_company_id());

DROP POLICY IF EXISTS "editors_can_create_docs" ON documents;
CREATE POLICY "editors_can_create_docs" ON documents
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
        AND company_id = documents.company_id
        AND status = 'active'
        AND role IN ('owner', 'admin', 'editor')
    )
  );

DROP POLICY IF EXISTS "admins_can_delete_docs" ON documents;
CREATE POLICY "admins_can_delete_docs" ON documents
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
        AND company_id = documents.company_id
        AND status = 'active'
        AND role IN ('owner', 'admin')
    )
  );

-- document_versions: company isolation (mutations blocked by trigger below)
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation" ON document_versions;
CREATE POLICY "company_isolation" ON document_versions
  FOR ALL
  USING (company_id = get_user_company_id());

-- navigation_manifests
ALTER TABLE navigation_manifests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation" ON navigation_manifests;
CREATE POLICY "company_isolation" ON navigation_manifests
  FOR ALL
  USING (company_id = get_user_company_id());

-- users: a user always sees their own row, plus rows for their company
-- (so the members page works). Self-access first so sign-up works before
-- the users row has a company_id.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "self_or_company" ON users;
CREATE POLICY "self_or_company" ON users
  FOR ALL
  USING (
    id = auth.uid()
    OR company_id = get_user_company_id()
  );

-- agent_access_tokens: company isolation; admin-only create/revoke is
-- enforced in the application layer.
ALTER TABLE agent_access_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation" ON agent_access_tokens;
CREATE POLICY "company_isolation" ON agent_access_tokens
  FOR ALL
  USING (company_id = get_user_company_id());

-- audit_events: SELECT for company members; INSERT allowed (service role
-- bypasses RLS anyway, so this is the belt-and-braces path). UPDATE and
-- DELETE are permanently blocked by the immutability trigger below — no
-- policy grants them.
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation_select" ON audit_events;
CREATE POLICY "company_isolation_select" ON audit_events
  FOR SELECT
  USING (company_id = get_user_company_id());

DROP POLICY IF EXISTS "company_isolation_insert" ON audit_events;
CREATE POLICY "company_isolation_insert" ON audit_events
  FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

-- usage_records: read-only from the app perspective. Inserts happen
-- server-side via the service role.
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_isolation_select" ON usage_records;
CREATE POLICY "company_isolation_select" ON usage_records
  FOR SELECT
  USING (company_id = get_user_company_id());

-- --------------------------------------------------------------------
-- Immutability triggers.
--
-- Defense in depth against accidental UPDATE/DELETE of append-only rows.
-- The service role bypasses RLS but NOT triggers, so these fire for
-- every caller including our own server code.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: UPDATE and DELETE are prohibited.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_mutation();

CREATE OR REPLACE FUNCTION prevent_document_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'document_versions is append-only: UPDATE and DELETE are prohibited.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_versions_immutable ON document_versions;
CREATE TRIGGER document_versions_immutable
  BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_document_version_mutation();

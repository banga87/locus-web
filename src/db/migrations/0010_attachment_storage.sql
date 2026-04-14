-- Migration 0010: Supabase Storage bucket + RLS for the Phase 1.5
-- attachment pipeline.
--
-- Phase 1 didn't use Storage, so this migration is the introduction
-- point. We create a single private bucket `attachments` and
-- tenant-scoped INSERT/SELECT/UPDATE/DELETE policies that gate access
-- by the attachment's company_id, derived from the object path.
--
-- Path convention (fixed):
--   attachments/{company_id}/{session_id}/{attachment_id}
--
-- Policies inspect `(storage.foldername(name))[1]` to extract the
-- company_id segment and match it against `get_user_company_id()` —
-- the same helper used elsewhere in the RLS surface (migration 0003).
--
-- We also add a second predicate on INSERT/UPDATE: the session_id
-- segment (second folder) must belong to the caller. This mirrors
-- the `session_attachments` RLS added in migration 0009 so the two
-- surfaces (the DB row and the Storage object) are consistent.
--
-- Idempotent: the bucket is inserted via ON CONFLICT DO NOTHING; the
-- policies drop-if-exists before re-creating.

-- --------------------------------------------------------------------
-- 1. Create the bucket (private, size-limited to 10MB per object).
--
-- `file_size_limit` in bytes. `allowed_mime_types` is a belt-and-braces
-- check — the API route validates the whitelist first, but if someone
-- uploads directly via a service-role key this column stops unknown
-- mimes. Deliberately NOT relying on `public` (false) alone; the RLS
-- policies below are the primary access control.
-- --------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,
  10485760,  -- 10 MB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------
-- 2. RLS policies on storage.objects for this bucket.
--
-- Postgres helper: storage.foldername(name) returns a text[] of the
-- path segments. Segment 1 is the bucket-root folder (company_id),
-- segment 2 is the session_id, segment 3 is the attachment_id.
--
-- get_user_company_id() is defined in migration 0003 and returns the
-- caller's company_id from public.users via auth.uid().
-- --------------------------------------------------------------------

DROP POLICY IF EXISTS "attachments_select_company_scoped" ON storage.objects;
CREATE POLICY "attachments_select_company_scoped" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = get_user_company_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM sessions WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "attachments_insert_company_scoped" ON storage.objects;
CREATE POLICY "attachments_insert_company_scoped" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = get_user_company_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM sessions WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "attachments_update_company_scoped" ON storage.objects;
CREATE POLICY "attachments_update_company_scoped" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = get_user_company_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM sessions WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = get_user_company_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM sessions WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "attachments_delete_company_scoped" ON storage.objects;
CREATE POLICY "attachments_delete_company_scoped" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = get_user_company_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM sessions WHERE user_id = auth.uid()
    )
  );

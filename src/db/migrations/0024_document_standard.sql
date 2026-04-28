-- Adds the document-standard + topic-vocabulary surface (Phase 1 of the
-- refined-focus build).
--
-- Three columns on documents: pending_review (set true by Maintenance
-- Agent in a later phase; created here so the column exists), topics
-- (the typed taxonomy field — replaces any reliance on the freeform
-- `tags` jsonb for taxonomy purposes), source (provenance string,
-- "agent:<name>" / "human:<name>" / "agent:maintenance").
--
-- One column on brains: topic_vocabulary jsonb. Stores the full
-- vocabulary blob ({ terms: [...], synonyms: {...}, version }) per the
-- "lean" sequencing decision — no separate term/synonym tables.
--
-- One new table: inbox_items. Schema only — no API, page, or cron
-- writes here yet (those land in Phase 3B).
--
-- All statements use IF NOT EXISTS / CREATE TABLE IF NOT EXISTS guards so
-- re-running apply-custom-migrations.ts (which executes every migration on
-- every invocation) is safe and produces no errors on an already-migrated DB.

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "pending_review" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "topics" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint

-- Partial index — Inbox queries scan only the open-review subset.
CREATE INDEX IF NOT EXISTS "documents_pending_review_idx"
  ON "documents" USING btree ("brain_id", "pending_review")
  WHERE "pending_review" = true;
--> statement-breakpoint

-- GIN index — search_documents will filter by topic membership.
CREATE INDEX IF NOT EXISTS "documents_topics_idx"
  ON "documents" USING gin ("topics");
--> statement-breakpoint

ALTER TABLE "brains"
  ADD COLUMN IF NOT EXISTS "topic_vocabulary" jsonb NOT NULL DEFAULT '{}';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inbox_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "brain_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "proposed_action" jsonb NOT NULL DEFAULT '{}',
  "context" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'pending',
  "decided_at" timestamptz,
  "decided_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  CONSTRAINT "inbox_items_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
    ON DELETE RESTRICT,
  CONSTRAINT "inbox_items_brain_id_brains_id_fk"
    FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id")
    ON DELETE CASCADE,
  CONSTRAINT "inbox_items_document_id_documents_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id")
    ON DELETE CASCADE,
  CONSTRAINT "inbox_items_kind_check"
    CHECK ("kind" IN ('near_duplicate', 'reclassification', 'missing_field')),
  CONSTRAINT "inbox_items_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'modified', 'expired'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "inbox_items_company_status_created_idx"
  ON "inbox_items" USING btree ("company_id", "status", "created_at" DESC);

-- Rename categories → folders, add parent_id for nesting,
-- add documents.is_pinned for the sidebar Pinned section.
ALTER TABLE "categories" RENAME TO "folders";--> statement-breakpoint
ALTER TABLE "folders" RENAME CONSTRAINT "categories_company_id_companies_id_fk" TO "folders_company_id_companies_id_fk";--> statement-breakpoint
ALTER TABLE "folders" RENAME CONSTRAINT "categories_brain_id_brains_id_fk" TO "folders_brain_id_brains_id_fk";--> statement-breakpoint

ALTER INDEX "categories_company_id_idx" RENAME TO "folders_company_id_idx";--> statement-breakpoint
ALTER INDEX "categories_brain_id_idx" RENAME TO "folders_brain_id_idx";--> statement-breakpoint
ALTER INDEX "categories_brain_slug_idx" RENAME TO "folders_brain_slug_idx";--> statement-breakpoint

-- Nesting: null parent_id means top-level folder. RESTRICT on delete so we
-- can't nuke a folder with children in one shot; app code walks and prompts.
ALTER TABLE "folders" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_parent_id_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint

-- Drop the old (brain_id, slug) uniqueness — slugs now unique per parent.
DROP INDEX "folders_brain_slug_idx";--> statement-breakpoint
-- Partial unique indexes: one for top-level (NULL parent), one for nested.
CREATE UNIQUE INDEX "folders_top_slug_idx" ON "folders" USING btree ("brain_id","slug") WHERE "parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_nested_slug_idx" ON "folders" USING btree ("parent_id","slug") WHERE "parent_id" IS NOT NULL;--> statement-breakpoint

-- Rename documents.category_id → folder_id.
ALTER TABLE "documents" RENAME COLUMN "category_id" TO "folder_id";--> statement-breakpoint
ALTER TABLE "documents" RENAME CONSTRAINT "documents_category_id_categories_id_fk" TO "documents_folder_id_folders_id_fk";--> statement-breakpoint
ALTER INDEX "documents_category_id_idx" RENAME TO "documents_folder_id_idx";--> statement-breakpoint

-- Pinning: brain-scoped, boolean on the document itself.
ALTER TABLE "documents" ADD COLUMN "is_pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_brain_pinned_idx" ON "documents" USING btree ("brain_id","is_pinned") WHERE "is_pinned" = true;--> statement-breakpoint

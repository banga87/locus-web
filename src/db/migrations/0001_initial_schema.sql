CREATE TYPE "public"."actor_type" AS ENUM('human', 'agent_token', 'platform_agent', 'maintenance_agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."agent_token_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."audit_event_category" AS ENUM('document_access', 'document_mutation', 'proposal', 'confidence', 'authentication', 'maintenance', 'administration', 'token_usage');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'deactivated');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(128) NOT NULL,
	"tier" varchar(32) DEFAULT 'starter' NOT NULL,
	"industry" varchar(128),
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "brains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(128) NOT NULL,
	"description" text,
	"current_version" timestamp with time zone DEFAULT now() NOT NULL,
	"health_score" integer,
	"document_count" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brain_id" uuid NOT NULL,
	"slug" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"role" "user_role" DEFAULT 'viewer',
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"full_name" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"avatar_url" text,
	"invited_by" uuid,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brain_id" uuid NOT NULL,
	"category_id" uuid,
	"title" text NOT NULL,
	"slug" varchar(256) NOT NULL,
	"path" varchar(512) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"summary" text,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"owner_id" uuid,
	"confidence_level" "confidence_level" DEFAULT 'medium' NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"token_estimate" integer DEFAULT 0,
	"version" integer DEFAULT 1 NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"related_documents" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" text NOT NULL,
	"change_summary" text,
	"changed_by" text NOT NULL,
	"changed_by_type" text DEFAULT 'human' NOT NULL,
	"metadata_snapshot" jsonb DEFAULT '{}'::jsonb,
	"proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "navigation_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brain_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"version" timestamp with time zone DEFAULT now() NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"token_prefix" varchar(16) NOT NULL,
	"scopes" text[] DEFAULT '{"read"}' NOT NULL,
	"status" "agent_token_status" DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"total_requests" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"category" "audit_event_category" NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text,
	"target_type" varchar(64),
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb,
	"ip_address" varchar(45),
	"session_id" uuid,
	"token_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid,
	"token_id" uuid,
	"session_id" uuid,
	"model" text,
	"provider" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"provider_cost_usd" real DEFAULT 0 NOT NULL,
	"customer_cost_usd" real DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brains" ADD CONSTRAINT "brains_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "navigation_manifests" ADD CONSTRAINT "navigation_manifests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "navigation_manifests" ADD CONSTRAINT "navigation_manifests_brain_id_brains_id_fk" FOREIGN KEY ("brain_id") REFERENCES "public"."brains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_access_tokens" ADD CONSTRAINT "agent_access_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brains_company_id_idx" ON "brains" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "categories_company_id_idx" ON "categories" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "categories_brain_id_idx" ON "categories" USING btree ("brain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_brain_slug_idx" ON "categories" USING btree ("brain_id","slug");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_company_id_idx" ON "users" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "users_company_status_idx" ON "users" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "users_company_role_idx" ON "users" USING btree ("company_id","role");--> statement-breakpoint
CREATE INDEX "documents_company_id_idx" ON "documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "documents_brain_id_idx" ON "documents" USING btree ("brain_id");--> statement-breakpoint
CREATE INDEX "documents_category_id_idx" ON "documents" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "documents_brain_path_idx" ON "documents" USING btree ("brain_id","path");--> statement-breakpoint
CREATE INDEX "documents_brain_status_idx" ON "documents" USING btree ("brain_id","status");--> statement-breakpoint
CREATE INDEX "documents_brain_is_core_idx" ON "documents" USING btree ("brain_id","is_core");--> statement-breakpoint
CREATE INDEX "documents_owner_id_idx" ON "documents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "documents_deleted_at_idx" ON "documents" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "documents_search_vector_idx" ON "documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "doc_versions_company_id_idx" ON "document_versions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "doc_versions_document_id_idx" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_versions_document_version_idx" ON "document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "nav_manifests_company_id_idx" ON "navigation_manifests" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "nav_manifests_brain_current_idx" ON "navigation_manifests" USING btree ("brain_id","is_current");--> statement-breakpoint
CREATE INDEX "agent_tokens_company_id_idx" ON "agent_access_tokens" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "agent_tokens_hash_idx" ON "agent_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_tokens_status_idx" ON "agent_access_tokens" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "audit_events_company_id_idx" ON "audit_events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_events_category_idx" ON "audit_events" USING btree ("company_id","category");--> statement-breakpoint
CREATE INDEX "audit_events_event_type_idx" ON "audit_events" USING btree ("company_id","event_type");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("company_id","actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("company_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_records_company_id_idx" ON "usage_records" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "usage_records_user_id_idx" ON "usage_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_records_created_at_idx" ON "usage_records" USING btree ("company_id","created_at");
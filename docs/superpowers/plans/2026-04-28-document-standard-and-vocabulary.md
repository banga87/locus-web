# Document Standard + Topic Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Phase 1 of the refined-focus build: schema columns, the 33-term default vocabulary, the seven-folder taxonomy, the seven document-type frontmatter validators, the workspace seeding path, and the dependency-free MCP read tools (`get_taxonomy`, `get_type_schema`, plus filter extensions on `search_documents`). After this plan, an external agent can discover the workspace's vocabulary and type schemas; write paths and the Maintenance Agent come in subsequent plans.

**Architecture:** Single migration (0024) adds the columns and `inbox_items` table. A new namespace `src/lib/document-standard/` owns folder/type constants and the per-type Zod validators. A new namespace `src/lib/taxonomy/` owns the default vocabulary, the synonym map, the seed function, and a pure validator. The vocabulary is stored as a JSONB blob on `brains` (per sequencing doc's "lean" recommendation — no separate term/synonym tables). Two new MCP read tools expose the taxonomy and type schemas; `search_documents` gains four new filters. The existing `src/lib/brain/frontmatter.ts` (a narrow response-output serializer) and `src/lib/frontmatter/` (Tiptap registry) are left untouched — this work lives in its own module.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres (via Supabase), Zod, Vitest, Vercel AI SDK Tool registry. The DB tests run against live Supabase via the postgres superuser connection, following the pattern in `src/__tests__/integration/helpers.ts`.

**Scope guardrails:**
- This plan ships ONLY Phase 1 from `docs/superpowers/specs/refined-focus/2026-04-28-implementation-sequencing.md`. Maintenance Agent (Phase 2), MCP write tools (Phase 3A), and Inbox UI (Phase 3B) get their own plans.
- The `inbox_items` *table* is created here (it's foundational schema), but no API, page, or cron touches it yet.
- The `pending_review` column on `documents` is created here. Nothing sets it to `true` yet — Phase 2 does.
- The seven new document types (canonical, decision, note, fact, procedure, entity, artifact) coexist with the three existing reserved types (`agent-scaffolding`, `agent-definition`, `skill`). The validator allows the reserved types through unchanged; existing tooling continues to work.
- Existing universal-pack content (4 generic folders, 10 docs) is replaced by the 7-folder spec layout. Pre-launch reset is acceptable per project memory ("Phase 0 shipped, dev DB has no real users").
- Reference: `docs/superpowers/specs/refined-focus/2026-04-25-tatara-document-standard.md`, `docs/superpowers/specs/refined-focus/2026-04-25-tatara-default-topic-vocabulary.md`, `docs/superpowers/specs/refined-focus/2026-04-28-implementation-sequencing.md`, and the read-tool wording in `docs/superpowers/specs/refined-focus/2026-04-25-tatara-mcp-tool-surface.md`.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/db/migrations/0024_document_standard.sql` | Add columns, indexes, `inbox_items` table |
| `src/db/schema/inbox-items.ts` | Drizzle schema for `inbox_items` |
| `src/lib/document-standard/constants.ts` | The 7 folders, 7 doc types, source-format prefix list |
| `src/lib/document-standard/types.ts` | TS types for universal + per-type frontmatter |
| `src/lib/document-standard/universal-schema.ts` | Zod schema for the universal frontmatter block |
| `src/lib/document-standard/type-schemas/canonical.ts` | Per-type Zod schemas (one file per type) |
| `src/lib/document-standard/type-schemas/decision.ts` | |
| `src/lib/document-standard/type-schemas/note.ts` | |
| `src/lib/document-standard/type-schemas/fact.ts` | |
| `src/lib/document-standard/type-schemas/procedure.ts` | |
| `src/lib/document-standard/type-schemas/entity.ts` | |
| `src/lib/document-standard/type-schemas/artifact.ts` | |
| `src/lib/document-standard/type-schemas/index.ts` | Registry mapping `type` → schema + JSON-Schema-shape examples |
| `src/lib/document-standard/validate.ts` | `validateDocumentFrontmatter(input, vocabulary)` — combines universal + per-type + topic validation |
| `src/lib/document-standard/__tests__/...` | Per-schema + master-validator tests |
| `src/lib/taxonomy/default-vocabulary.ts` | The 33 terms (with descriptions) + the synonym map |
| `src/lib/taxonomy/types.ts` | TS types for the persisted vocabulary blob |
| `src/lib/taxonomy/seed.ts` | `seedDefaultVocabulary(brainId)` |
| `src/lib/taxonomy/get.ts` | `getTaxonomy(brainId)` — reads from `brains.topic_vocabulary` |
| `src/lib/taxonomy/validate.ts` | `validateTopics(input, vocabulary)` — pure, returns canonical terms or rejected list with synonym hints |
| `src/lib/taxonomy/__tests__/...` | Vocabulary + validator tests |
| `src/lib/tools/implementations/get-taxonomy.ts` | MCP read tool — wraps `getTaxonomy` |
| `src/lib/tools/implementations/get-type-schema.ts` | MCP read tool — returns the schema for one type |
| `src/lib/tools/implementations/__tests__/get-taxonomy.test.ts` | |
| `src/lib/tools/implementations/__tests__/get-type-schema.test.ts` | |
| `src/__tests__/integration/document-standard-e2e.test.ts` | Seeded brain → MCP read tools return correct data |

### Modified files

| Path | Change |
|---|---|
| `src/db/schema/documents.ts` | Add `pendingReview`, `topics`, `source`; add GIN index on `topics`, partial index on `pendingReview` |
| `src/db/schema/brains.ts` | Add `topicVocabulary` jsonb column |
| `src/db/schema/index.ts` | Export `inboxItems` |
| `src/lib/templates/universal-pack.ts` | Replace 4-folder/10-doc pack with the spec's 7 folders; minimal seed of 0 docs (folders alone — no opinionated seed content for v1) |
| `src/lib/templates/seed.ts` | Call `seedDefaultVocabulary` after folder/document insert |
| `src/lib/templates/__tests__/seed.test.ts` | Update assertions to the new 7-folder shape and vocabulary seed |
| `src/lib/tools/index.ts` | Register `getTaxonomyTool` and `getTypeSchemaTool` |
| `src/lib/tools/implementations/search-documents.ts` | Add `type`, `folder`, `topics`, `confidence_min` filters; rename `category` → `folder` |
| `src/lib/tools/implementations/__tests__/search-documents.test.ts` | Cover the four new filters |
| `src/lib/mcp/handler.ts` | Add `get_taxonomy`, `get_type_schema` to `MCP_ALLOWED_TOOLS` |
| `src/lib/mcp/tools.ts` | Register `get_taxonomy`, `get_type_schema`; update `search_documents` Zod shape with the four new filters |
| `src/lib/mcp/__tests__/...` | Cover the new MCP tools end-to-end |
| `src/__tests__/integration/helpers.ts` | No source change. `createSeededCompany` calls `seedBrainFromUniversalPack`, which now also seeds the vocabulary — every existing integration test inherits the change automatically. The `cleanupCompany` and `createTestToken` helpers already exist; new tests use them as-is. |
| `src/__tests__/integration/mvp-mcp-in-read.test.ts` | Cover the new MCP read tools end-to-end |

---

## Pre-flight: verify the workspace before starting

**Before running any task, confirm the working assumption:**

```bash
cd C:/Code/locus/locus-web
npx vitest run src/db/__tests__/schema.test.ts
```

Expected: PASS. If the schema tests fail before this plan begins, fix that first — the schema migrations in this plan will be unreliable on a broken baseline.

**Migration numbering check.** The repo applies hand-written SQL migrations via `scripts/apply-custom-migrations.ts` (drizzle-kit's auto-generated journal at `src/db/migrations/meta/_journal.json` is incomplete and not the source of truth). Confirm the next free index by listing the migrations directory:

```bash
ls src/db/migrations/*.sql | sort | tail -5
```

Expected: latest is `0023_documents_embedding.sql`. The new migration file MUST be `0024_document_standard.sql`. If 0024 is already taken, renumber yours and update every reference below.

---

## Task 1: Migration 0024 — schema additions

**Files:**
- Create: `src/db/migrations/0024_document_standard.sql`
- Create: `src/db/schema/inbox-items.ts`
- Modify: `src/db/schema/documents.ts`
- Modify: `src/db/schema/brains.ts`
- Modify: `src/db/schema/index.ts`
- Test: `src/db/__tests__/document-standard-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `src/db/__tests__/document-standard-schema.test.ts`:

```ts
// Verifies that migration 0024's columns and the inbox_items table
// exist with the right shape. Lives alongside schema.test.ts and uses
// the same superuser DATABASE_URL.

import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

describe('migration 0024 — document standard + vocabulary', () => {
  it('documents has pending_review boolean default false', async () => {
    const rows = await db.execute(sql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'pending_review'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('boolean');
    expect(String(rows[0].column_default)).toContain('false');
  });

  it('documents has topics text[] default {}', async () => {
    const rows = await db.execute(sql`
      SELECT column_name, data_type, udt_name, column_default
      FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'topics'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('ARRAY');
    expect(rows[0].udt_name).toBe('_text');
  });

  it('documents has source text column', async () => {
    const rows = await db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'source'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('text');
  });

  it('documents has GIN index on topics and partial index on pending_review', async () => {
    const rows = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'documents'
    `);
    const names = rows.map((r) => String(r.indexname));
    expect(names).toContain('documents_topics_idx');
    expect(names).toContain('documents_pending_review_idx');
  });

  it('brains has topic_vocabulary jsonb default {}', async () => {
    const rows = await db.execute(sql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'brains' AND column_name = 'topic_vocabulary'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('jsonb');
    expect(String(rows[0].column_default)).toContain("'{}'");
  });

  it('inbox_items table exists with required columns', async () => {
    const rows = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'inbox_items'
      ORDER BY ordinal_position
    `);
    const names = rows.map((r) => String(r.column_name));
    expect(names).toEqual([
      'id',
      'company_id',
      'brain_id',
      'document_id',
      'kind',
      'proposed_action',
      'context',
      'status',
      'decided_at',
      'decided_by',
      'created_at',
      'expires_at',
    ]);
  });

  it('inbox_items has index on (company_id, status, created_at desc)', async () => {
    const rows = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'inbox_items'
    `);
    const names = rows.map((r) => String(r.indexname));
    expect(names).toContain('inbox_items_company_status_created_idx');
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/db/__tests__/document-standard-schema.test.ts
```

Expected: FAIL — column / table / index not found. (The connection itself must succeed; if vitest cannot reach the DB, fix `DATABASE_URL` in `.env` before continuing.)

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/0024_document_standard.sql`:

```sql
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

ALTER TABLE "documents"
  ADD COLUMN "pending_review" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "documents"
  ADD COLUMN "topics" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "documents"
  ADD COLUMN "source" text;
--> statement-breakpoint

-- Partial index — Inbox queries scan only the open-review subset.
CREATE INDEX "documents_pending_review_idx"
  ON "documents" USING btree ("brain_id", "pending_review")
  WHERE "pending_review" = true;
--> statement-breakpoint

-- GIN index — search_documents will filter by topic membership.
CREATE INDEX "documents_topics_idx"
  ON "documents" USING gin ("topics");
--> statement-breakpoint

ALTER TABLE "brains"
  ADD COLUMN "topic_vocabulary" jsonb NOT NULL DEFAULT '{}';
--> statement-breakpoint

CREATE TABLE "inbox_items" (
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

CREATE INDEX "inbox_items_company_status_created_idx"
  ON "inbox_items" USING btree ("company_id", "status", "created_at" DESC);
```

- [ ] **Step 4: Register and apply the migration**

The migration runner is `scripts/apply-custom-migrations.ts`, which has a hardcoded `CUSTOM_MIGRATIONS` array. Add `'0024_document_standard.sql'` to that array (preserve the existing alphabetical/numeric ordering):

```ts
// In scripts/apply-custom-migrations.ts, append to CUSTOM_MIGRATIONS:
const CUSTOM_MIGRATIONS = [
  // ...existing entries through '0019_skills_progressive_disclosure.sql'...
  '0024_document_standard.sql',
];
```

(0020–0023 are NOT in the array because they're drizzle-kit-managed schema-only migrations that `drizzle-kit push` applies. 0024 is hand-written DDL — same category as 0007/0011/0015 — so it goes here.)

Then run the script:

```bash
npx tsx scripts/apply-custom-migrations.ts
```

Expected: applies 0024 cleanly. The script's SQL is idempotent (this plan's DDL is not — `ALTER TABLE ADD COLUMN` will fail if re-run on a column that exists). If you need to re-run during development, drop the columns and table manually first.

- [ ] **Step 5: Update Drizzle schema — documents.ts**

Add these three fields to the `documents` pgTable definition in `src/db/schema/documents.ts`, right after the `confidenceLevel` block (preserve adjacent ordering and trailing-comma style):

```ts
    // Set true when the Maintenance Agent (Phase 2) routes a write to
    // the Inbox for human review. The doc is committed regardless;
    // this flag tells consuming agents/UI that a human hasn't OK'd it
    // yet. Cleared by the Inbox decide endpoint or by the 30-day
    // expiry cron (Phase 3B).
    pendingReview: boolean('pending_review').notNull().default(false),

    // Controlled-vocabulary tags — distinct from the freeform `tags`
    // jsonb above (which is legacy). Validated against
    // `brains.topic_vocabulary` at write time. Empty array is a valid
    // (if low-quality) state; agents are nudged toward 1–5 topics.
    topics: text('topics')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // Provenance string: "agent:<name>" | "human:<name>" |
    // "agent:maintenance". Stamped from auth context by the write
    // tool, never from agent input. Nullable for backward compat with
    // pre-Phase-1 rows; new rows always set it.
    source: text('source'),
```

In the same file, append two new entries to the indexes array (preserve trailing-comma style):

```ts
    // Inbox query — scans only docs awaiting review.
    index('documents_pending_review_idx')
      .on(table.brainId, table.pendingReview)
      .where(sql`"pending_review" = true`),
    // search_documents `topics` filter.
    index('documents_topics_idx').using('gin', table.topics),
```

Ensure `boolean` is in the Drizzle imports at the top (it already is — see line 18). Ensure `text` (already present) and `sql` (already imported on line 22) are usable.

- [ ] **Step 6: Update Drizzle schema — brains.ts**

Add to the `brains` pgTable definition in `src/db/schema/brains.ts`, after the `settings` field (preserve trailing-comma style):

```ts
    // Workspace topic vocabulary — { terms: [...], synonyms: {...},
    // version }. Seeded at brain provisioning (see
    // src/lib/taxonomy/seed.ts). v1 is fixed at 33 terms; admin
    // extension is out of scope.
    //
    // The default uses sql`'{}'::jsonb` to match the migration's
    // SQL DDL exactly. Drizzle's `default({})` for jsonb sometimes
    // emits parameterised empty objects instead of the SQL literal,
    // which can cause drizzle-kit drift on later introspection.
    topicVocabulary: jsonb('topic_vocabulary')
      .notNull()
      .default(sql`'{}'::jsonb`),
```

Verify `jsonb` is in the imports (it isn't yet — add it; also add `sql` from `drizzle-orm`):

```ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

- [ ] **Step 7: Create the inbox_items Drizzle schema**

Create `src/db/schema/inbox-items.ts`:

```ts
// Inbox queue — Maintenance Agent decisions awaiting human review.
//
// Phase 1 ships only the schema; the Maintenance Agent (Phase 2) writes
// rows; the API + UI (Phase 3B) reads/decides them. The table is
// created here because every later phase needs the migration in place.
//
// Design notes:
//   - companyId + brainId are denormalised for cheap-tenant scoping
//     without joins; FKs cascade-delete from brain so cleanup is free.
//   - kind / status are TEXT with CHECK constraints (not pgEnum) so
//     adding a new kind in v1.5 is a CHECK alteration, not an enum
//     migration — pragmatic given the values are still settling.
//   - expires_at is set at insert time to created_at + 30d. The Phase
//     3B cron flips status='expired' once now() > expires_at.

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './companies';
import { brains } from './brains';
import { documents } from './documents';

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),

    brainId: uuid('brain_id')
      .notNull()
      .references(() => brains.id, { onDelete: 'cascade' }),

    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    /** 'near_duplicate' | 'reclassification' | 'missing_field' */
    kind: text('kind').notNull(),

    /** Structured action the Maintenance Agent proposes. Shape varies
     *  per kind — Phase 2 will pin the schema. */
    proposedAction: jsonb('proposed_action').notNull().default({}),

    /** Cheap-pass context (e.g., { existing_doc_id, cosine,
     *  shared_topics } for near-duplicates). */
    context: jsonb('context').notNull().default({}),

    /** 'pending' | 'approved' | 'rejected' | 'modified' | 'expired' */
    status: text('status').notNull().default('pending'),

    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + INTERVAL '30 days'`),
  },
  (table) => [
    // DESC on createdAt matches the SQL DDL — Drizzle's `.on(...)`
    // defaults to ASC, so call `.desc()` explicitly.
    index('inbox_items_company_status_created_idx').on(
      table.companyId,
      table.status,
      table.createdAt.desc(),
    ),
  ],
);
```

- [ ] **Step 8: Export inbox_items from the schema barrel**

In `src/db/schema/index.ts`, add the export (read the file first to keep the existing alphabetical/grouping convention):

```ts
export * from './inbox-items';
```

- [ ] **Step 9: Run the test — should pass now**

```bash
npx vitest run src/db/__tests__/document-standard-schema.test.ts
```

Expected: PASS (all 7 cases).

- [ ] **Step 10: Run the broader schema suite to confirm nothing regressed**

```bash
npx vitest run src/db/__tests__/
```

Expected: PASS for all schema tests, including `schema.test.ts` and `workflow-tables.test.ts`.

- [ ] **Step 11: Commit**

```bash
git add src/db/migrations/0024_document_standard.sql \
        src/db/schema/inbox-items.ts \
        src/db/schema/documents.ts \
        src/db/schema/brains.ts \
        src/db/schema/index.ts \
        src/db/__tests__/document-standard-schema.test.ts
git commit -m "feat(db): add document-standard + topic-vocabulary schema (migration 0024)"
```

---

## Task 2: Document Standard constants — folders, types, source-format

**Files:**
- Create: `src/lib/document-standard/constants.ts`
- Create: `src/lib/document-standard/__tests__/constants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/document-standard/__tests__/constants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FOLDERS,
  FOLDER_DESCRIPTIONS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_DESCRIPTIONS,
  RESERVED_TYPES,
  isStandardType,
  isReservedType,
  SOURCE_PREFIXES,
} from '../constants';

describe('document-standard constants', () => {
  it('lists exactly the seven spec folders', () => {
    expect(FOLDERS).toEqual([
      'company',
      'customers',
      'market',
      'product',
      'marketing',
      'operations',
      'signals',
    ]);
  });

  it('every folder has a description', () => {
    for (const f of FOLDERS) {
      expect(FOLDER_DESCRIPTIONS[f].length).toBeGreaterThan(0);
    }
  });

  it('lists exactly the seven spec document types', () => {
    expect(DOCUMENT_TYPES).toEqual([
      'canonical',
      'decision',
      'note',
      'fact',
      'procedure',
      'entity',
      'artifact',
    ]);
  });

  it('every type has a description', () => {
    for (const t of DOCUMENT_TYPES) {
      expect(DOCUMENT_TYPE_DESCRIPTIONS[t].length).toBeGreaterThan(0);
    }
  });

  it('reserves the existing system types', () => {
    expect(RESERVED_TYPES).toEqual([
      'agent-scaffolding',
      'agent-definition',
      'skill',
    ]);
  });

  it('classifies types correctly', () => {
    expect(isStandardType('canonical')).toBe(true);
    expect(isStandardType('skill')).toBe(false);
    expect(isStandardType('unknown')).toBe(false);
    expect(isReservedType('skill')).toBe(true);
    expect(isReservedType('canonical')).toBe(false);
  });

  it('exposes the two source prefixes', () => {
    expect(SOURCE_PREFIXES).toEqual(['agent:', 'human:']);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/lib/document-standard/__tests__/constants.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the constants**

Create `src/lib/document-standard/constants.ts`:

```ts
// The seven folders, seven document types, and source-format prefixes
// defined by the Tatara Document Standard v1 spec
// (docs/superpowers/specs/refined-focus/2026-04-25-tatara-document-standard.md).
//
// The constants are the single source of truth. Anything that needs to
// know "is this a real folder?" or "is this a real type?" imports from
// here. Don't inline string literals elsewhere.

/**
 * The seven folders. Order is the spec's; agents may rely on it for
 * deterministic display.
 */
export const FOLDERS = [
  'company',
  'customers',
  'market',
  'product',
  'marketing',
  'operations',
  'signals',
] as const;

export type Folder = (typeof FOLDERS)[number];

export const FOLDER_DESCRIPTIONS: Record<Folder, string> = {
  company:
    'Brand voice, brand/design, mission, values, internal team, roles, structure.',
  customers:
    'CRM-flavored: customer accounts, contacts, conversations, feedback, account-level pricing.',
  market: 'ICPs, competitive landscape, positioning, market research.',
  product:
    'Products, pricing, roadmap, technical architecture, product research.',
  marketing:
    'Campaigns, email sequences, website copy, social content, events.',
  operations: 'Procedures, policies, tools, vendors.',
  signals:
    'Time-stamped raw input: rambles, meeting notes, slack captures, in-flight thoughts.',
};

/**
 * The seven document types. Order is the spec's.
 */
export const DOCUMENT_TYPES = [
  'canonical',
  'decision',
  'note',
  'fact',
  'procedure',
  'entity',
  'artifact',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_DESCRIPTIONS: Record<DocumentType, string> = {
  canonical:
    'Long-lived authoritative single-source-of-truth (e.g., brand voice, ICP definition, pricing structure).',
  decision: 'Decision record with provenance.',
  note:
    'Informal time-stamped capture (meeting notes, ramble, research-in-flight).',
  fact:
    'Atomic attributed statement with validity window (e.g., "Q4 revenue was $X").',
  procedure: 'Ordered runbook (e.g., "How we handle refund requests").',
  entity: 'Person/company/vendor record.',
  artifact:
    'Operational working doc with lifecycle (e.g., campaign brief, email sequence draft).',
};

/**
 * Existing system types that predate the standard. Documents with
 * these types skip the per-type frontmatter validators — their schemas
 * are owned by the agent / skill subsystems, not the document
 * standard. Listed here so the master validator can short-circuit
 * cleanly instead of failing them as "unknown type".
 */
export const RESERVED_TYPES = [
  'agent-scaffolding',
  'agent-definition',
  'skill',
] as const;

export type ReservedType = (typeof RESERVED_TYPES)[number];

export function isStandardType(value: unknown): value is DocumentType {
  return (
    typeof value === 'string' &&
    (DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

export function isReservedType(value: unknown): value is ReservedType {
  return (
    typeof value === 'string' &&
    (RESERVED_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Allowed `source` prefixes. The full source string is
 * `<prefix><identifier>` — e.g., `agent:claude-code`, `human:angus`,
 * `agent:maintenance`. Validation is just "starts with one of these".
 */
export const SOURCE_PREFIXES = ['agent:', 'human:'] as const;
```

- [ ] **Step 4: Run the test — should pass**

```bash
npx vitest run src/lib/document-standard/__tests__/constants.test.ts
```

Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/document-standard/constants.ts \
        src/lib/document-standard/__tests__/constants.test.ts
git commit -m "feat(document-standard): add folders, types, and source-format constants"
```

---

## Task 3: TypeScript types for universal + per-type frontmatter

**Files:**
- Create: `src/lib/document-standard/types.ts`

This is a typing-only step — no test (the types themselves are exercised by the schema tests in tasks 4 and 5). Adding a test file for type aliases would just duplicate the schema tests.

- [ ] **Step 1: Write the types**

Create `src/lib/document-standard/types.ts`:

```ts
// TS types for universal + per-type frontmatter blocks. These mirror
// the Zod schemas one-for-one (the schemas in `./universal-schema.ts`
// and `./type-schemas/*.ts` are the runtime source of truth — these
// are the typeck shape callers consume).

import type { DocumentType } from './constants';

export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type DocumentStatus = 'active' | 'archived' | 'superseded' | 'draft';

export interface UniversalFrontmatter {
  id: string;
  title: string;
  type: DocumentType | (string & {}); // reserved types pass through
  source: string;
  topics: string[];
  confidence: ConfidenceLevel;
  status: DocumentStatus;
}

export interface CanonicalFields {
  owner: string;
  last_reviewed_at: string; // ISO date
}

export interface DecisionFields {
  decided_by: string[];
  decided_on: string; // ISO date
  supersedes?: string;
  superseded_by?: string;
}

export interface NoteFields {
  captured_from: 'meeting' | 'slack' | 'call' | 'email' | 'other';
  participants?: string[];
  promotes_to?: string;
}

export interface FactFields {
  evidence: string;
  valid_from: string; // ISO date
  valid_to?: string;
}

export interface ProcedureFields {
  applies_to: string[];
  prerequisites?: string[];
}

export interface EntityFields {
  kind: 'person' | 'company' | 'vendor';
  relationship: 'customer' | 'prospect' | 'partner' | 'team' | 'other';
  contact_points?: string[];
  current_state: string;
  last_interaction?: string;
}

export interface ArtifactFields {
  lifecycle: 'draft' | 'live' | 'archived';
  version: number;
  owner: string;
  launched_at?: string;
  retired_at?: string;
  channel?: 'email' | 'web' | 'social' | 'event' | 'other';
}
```

- [ ] **Step 2: Confirm typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors. (Existing errors, if any, are pre-existing — note them but don't fix in this task.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/document-standard/types.ts
git commit -m "feat(document-standard): add universal + per-type frontmatter types"
```

---

## Task 4: Universal frontmatter Zod schema

**Files:**
- Create: `src/lib/document-standard/universal-schema.ts`
- Create: `src/lib/document-standard/__tests__/universal-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/document-standard/__tests__/universal-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { universalSchema, validateUniversal } from '../universal-schema';

describe('universalSchema', () => {
  const valid = {
    id: 'doc-001',
    title: 'Brand voice',
    type: 'canonical',
    source: 'human:angus',
    topics: ['brand', 'voice'],
    confidence: 'high',
    status: 'active',
  };

  it('accepts a well-formed universal block', () => {
    const result = universalSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts a reserved type (e.g. skill)', () => {
    const result = universalSchema.safeParse({ ...valid, type: 'skill' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const result = validateUniversal({ ...valid, type: 'novel' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'type')).toBe(true);
    }
  });

  it('rejects a missing required field', () => {
    const { confidence: _omit, ...rest } = valid;
    const result = validateUniversal(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'confidence')).toBe(true);
    }
  });

  it('rejects topics that are not strings', () => {
    const result = validateUniversal({ ...valid, topics: ['ok', 5] });
    expect(result.ok).toBe(false);
  });

  it('rejects more than 5 topics', () => {
    const result = validateUniversal({
      ...valid,
      topics: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /1.*5/.test(e.message))).toBe(true);
    }
  });

  it('rejects a source string with no recognised prefix', () => {
    const result = validateUniversal({ ...valid, source: 'unknown-actor' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'source')).toBe(true);
    }
  });

  it('accepts agent:maintenance and human:<x> sources', () => {
    expect(
      validateUniversal({ ...valid, source: 'agent:maintenance' }).ok,
    ).toBe(true);
    expect(validateUniversal({ ...valid, source: 'human:angus' }).ok).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/lib/document-standard/__tests__/universal-schema.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

Create `src/lib/document-standard/universal-schema.ts`:

```ts
// Zod schema for the universal frontmatter block — the seven keys
// every document type carries (id, title, type, source, topics,
// confidence, status). Per-type schemas (./type-schemas/*) layer on
// top via the master validator in ./validate.ts.
//
// `type` accepts both standard types (canonical, decision, note,
// fact, procedure, entity, artifact) and the three reserved system
// types (agent-scaffolding, agent-definition, skill) without nagging
// — reserved types skip per-type validation entirely. Anything else
// is rejected.

import { z } from 'zod';

import {
  DOCUMENT_TYPES,
  RESERVED_TYPES,
  SOURCE_PREFIXES,
  type DocumentType,
  type ReservedType,
} from './constants';

const allowedTypes = [...DOCUMENT_TYPES, ...RESERVED_TYPES] as const;

export const universalSchema = z.object({
  id: z.string().min(1, 'id is required'),
  title: z.string().min(1, 'title is required'),
  type: z.enum(allowedTypes, {
    errorMap: () => ({
      message: `type must be one of: ${allowedTypes.join(', ')}`,
    }),
  }),
  source: z
    .string()
    .min(1, 'source is required')
    .refine(
      (s) => SOURCE_PREFIXES.some((p) => s.startsWith(p)),
      `source must start with one of: ${SOURCE_PREFIXES.join(', ')} (e.g., "agent:claude-code", "human:angus")`,
    ),
  topics: z
    .array(z.string().min(1))
    .min(1, 'must include at least 1 topic')
    .max(5, 'must include between 1 and 5 topics'),
  confidence: z.enum(['low', 'medium', 'high']),
  status: z.enum(['active', 'archived', 'superseded', 'draft']),
});

export type UniversalParsed = z.infer<typeof universalSchema>;

export interface ValidationError {
  field: string;
  message: string;
}

export type UniversalResult =
  | { ok: true; value: UniversalParsed }
  | { ok: false; errors: ValidationError[] };

/**
 * Wrapper over `universalSchema.safeParse` that flattens Zod issues
 * into the {field, message} shape consumed by the master validator
 * and by the MCP write tools' error envelopes.
 */
export function validateUniversal(input: unknown): UniversalResult {
  const result = universalSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? String(issue.path[0]) : '_',
      message: issue.message,
    })),
  };
}

export function isReservedTypeValue(
  value: string,
): value is ReservedType {
  return (RESERVED_TYPES as readonly string[]).includes(value);
}

export function isStandardTypeValue(
  value: string,
): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Run the test — should pass**

```bash
npx vitest run src/lib/document-standard/__tests__/universal-schema.test.ts
```

Expected: PASS (8 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/document-standard/universal-schema.ts \
        src/lib/document-standard/__tests__/universal-schema.test.ts
git commit -m "feat(document-standard): add universal frontmatter Zod schema"
```

---

## Task 5: Per-type frontmatter Zod schemas (seven schemas)

**Files:**
- Create: `src/lib/document-standard/type-schemas/canonical.ts`
- Create: `src/lib/document-standard/type-schemas/decision.ts`
- Create: `src/lib/document-standard/type-schemas/note.ts`
- Create: `src/lib/document-standard/type-schemas/fact.ts`
- Create: `src/lib/document-standard/type-schemas/procedure.ts`
- Create: `src/lib/document-standard/type-schemas/entity.ts`
- Create: `src/lib/document-standard/type-schemas/artifact.ts`
- Create: `src/lib/document-standard/type-schemas/index.ts`
- Create: `src/lib/document-standard/type-schemas/__tests__/all-types.test.ts`

Per-type schemas are small and similarly shaped, so we batch them in one task with one consolidated test file. Each is its own file for navigability.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/document-standard/type-schemas/__tests__/all-types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { typeSchemaRegistry } from '../index';

describe('per-type frontmatter schemas', () => {
  describe('canonical', () => {
    const schema = typeSchemaRegistry.canonical.schema;
    it('accepts {owner, last_reviewed_at}', () => {
      expect(
        schema.safeParse({
          owner: 'angus',
          last_reviewed_at: '2026-04-01',
        }).success,
      ).toBe(true);
    });
    it('rejects missing owner', () => {
      expect(
        schema.safeParse({ last_reviewed_at: '2026-04-01' }).success,
      ).toBe(false);
    });
  });

  describe('decision', () => {
    const schema = typeSchemaRegistry.decision.schema;
    it('accepts {decided_by, decided_on}', () => {
      expect(
        schema.safeParse({
          decided_by: ['angus', 'sam'],
          decided_on: '2026-04-01',
        }).success,
      ).toBe(true);
    });
    it('accepts optional supersedes/superseded_by', () => {
      expect(
        schema.safeParse({
          decided_by: ['angus'],
          decided_on: '2026-04-01',
          supersedes: 'doc-prior',
        }).success,
      ).toBe(true);
    });
    it('rejects empty decided_by', () => {
      expect(
        schema.safeParse({ decided_by: [], decided_on: '2026-04-01' })
          .success,
      ).toBe(false);
    });
  });

  describe('note', () => {
    const schema = typeSchemaRegistry.note.schema;
    it('accepts captured_from = meeting', () => {
      expect(
        schema.safeParse({ captured_from: 'meeting' }).success,
      ).toBe(true);
    });
    it('rejects unknown captured_from', () => {
      expect(
        schema.safeParse({ captured_from: 'desk' }).success,
      ).toBe(false);
    });
  });

  describe('fact', () => {
    const schema = typeSchemaRegistry.fact.schema;
    it('accepts {evidence, valid_from}', () => {
      expect(
        schema.safeParse({
          evidence: 'doc-2026-04',
          valid_from: '2026-01-01',
        }).success,
      ).toBe(true);
    });
    it('rejects missing valid_from', () => {
      expect(
        schema.safeParse({ evidence: 'doc-2026-04' }).success,
      ).toBe(false);
    });
  });

  describe('procedure', () => {
    const schema = typeSchemaRegistry.procedure.schema;
    it('accepts non-empty applies_to', () => {
      expect(
        schema.safeParse({ applies_to: ['refund-request'] }).success,
      ).toBe(true);
    });
    it('rejects empty applies_to', () => {
      expect(schema.safeParse({ applies_to: [] }).success).toBe(false);
    });
  });

  describe('entity', () => {
    const schema = typeSchemaRegistry.entity.schema;
    it('accepts a customer person', () => {
      expect(
        schema.safeParse({
          kind: 'person',
          relationship: 'customer',
          current_state: 'active subscriber',
        }).success,
      ).toBe(true);
    });
    it('rejects unknown kind', () => {
      expect(
        schema.safeParse({
          kind: 'spaceship',
          relationship: 'customer',
          current_state: 'x',
        }).success,
      ).toBe(false);
    });
  });

  describe('artifact', () => {
    const schema = typeSchemaRegistry.artifact.schema;
    it('accepts a live artifact', () => {
      expect(
        schema.safeParse({
          lifecycle: 'live',
          version: 1,
          owner: 'angus',
        }).success,
      ).toBe(true);
    });
    it('rejects negative version', () => {
      expect(
        schema.safeParse({
          lifecycle: 'live',
          version: -1,
          owner: 'angus',
        }).success,
      ).toBe(false);
    });
  });

  it('registry covers all seven standard types', () => {
    expect(Object.keys(typeSchemaRegistry).sort()).toEqual([
      'artifact',
      'canonical',
      'decision',
      'entity',
      'fact',
      'note',
      'procedure',
    ]);
  });

  it('every entry has a non-empty `example`', () => {
    for (const [type, entry] of Object.entries(typeSchemaRegistry)) {
      expect(
        Object.keys(entry.example).length,
        `example for ${type} must be non-empty`,
      ).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
npx vitest run src/lib/document-standard/type-schemas/__tests__/all-types.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seven schemas**

Create `src/lib/document-standard/type-schemas/canonical.ts`:

```ts
import { z } from 'zod';

export const canonicalSchema = z.object({
  owner: z.string().min(1, 'owner is required'),
  last_reviewed_at: z.string().min(1, 'last_reviewed_at is required (ISO date)'),
});

export const canonicalExample = {
  owner: 'angus',
  last_reviewed_at: '2026-04-01',
};
```

Create `src/lib/document-standard/type-schemas/decision.ts`:

```ts
import { z } from 'zod';

export const decisionSchema = z.object({
  decided_by: z
    .array(z.string().min(1))
    .min(1, 'decided_by must list at least one actor'),
  decided_on: z.string().min(1, 'decided_on is required (ISO date)'),
  supersedes: z.string().optional(),
  superseded_by: z.string().optional(),
});

export const decisionExample = {
  decided_by: ['angus'],
  decided_on: '2026-04-01',
};
```

Create `src/lib/document-standard/type-schemas/note.ts`:

```ts
import { z } from 'zod';

export const noteSchema = z.object({
  captured_from: z.enum(['meeting', 'slack', 'call', 'email', 'other']),
  participants: z.array(z.string().min(1)).optional(),
  promotes_to: z.string().optional(),
});

export const noteExample = {
  captured_from: 'meeting' as const,
};
```

Create `src/lib/document-standard/type-schemas/fact.ts`:

```ts
import { z } from 'zod';

export const factSchema = z.object({
  evidence: z.string().min(1, 'evidence is required (URL or doc id)'),
  valid_from: z.string().min(1, 'valid_from is required (ISO date)'),
  valid_to: z.string().optional(),
});

export const factExample = {
  evidence: 'doc-revenue-q4',
  valid_from: '2026-01-01',
};
```

Create `src/lib/document-standard/type-schemas/procedure.ts`:

```ts
import { z } from 'zod';

export const procedureSchema = z.object({
  applies_to: z
    .array(z.string().min(1))
    .min(1, 'applies_to must list at least one trigger context'),
  prerequisites: z.array(z.string().min(1)).optional(),
});

export const procedureExample = {
  applies_to: ['refund-request'],
};
```

Create `src/lib/document-standard/type-schemas/entity.ts`:

```ts
import { z } from 'zod';

export const entitySchema = z.object({
  kind: z.enum(['person', 'company', 'vendor']),
  relationship: z.enum(['customer', 'prospect', 'partner', 'team', 'other']),
  contact_points: z.array(z.string().min(1)).optional(),
  current_state: z.string().min(1, 'current_state is required (one-line summary)'),
  last_interaction: z.string().optional(),
});

export const entityExample = {
  kind: 'company' as const,
  relationship: 'customer' as const,
  current_state: 'Active subscriber, monthly billing',
};
```

Create `src/lib/document-standard/type-schemas/artifact.ts`:

```ts
import { z } from 'zod';

export const artifactSchema = z.object({
  lifecycle: z.enum(['draft', 'live', 'archived']),
  version: z.number().int().nonnegative(),
  owner: z.string().min(1, 'owner is required'),
  launched_at: z.string().optional(),
  retired_at: z.string().optional(),
  channel: z.enum(['email', 'web', 'social', 'event', 'other']).optional(),
});

export const artifactExample = {
  lifecycle: 'draft' as const,
  version: 1,
  owner: 'angus',
};
```

Create the registry, `src/lib/document-standard/type-schemas/index.ts`:

```ts
// Registry mapping a standard document type to its Zod schema and a
// minimal valid example. The MCP `get_type_schema` tool reads this
// registry directly — there is no separate config to keep in sync.

import type { z } from 'zod';

import type { DocumentType } from '../constants';

import { canonicalSchema, canonicalExample } from './canonical';
import { decisionSchema, decisionExample } from './decision';
import { noteSchema, noteExample } from './note';
import { factSchema, factExample } from './fact';
import { procedureSchema, procedureExample } from './procedure';
import { entitySchema, entityExample } from './entity';
import { artifactSchema, artifactExample } from './artifact';

export interface TypeSchemaEntry {
  schema: z.ZodTypeAny;
  example: Record<string, unknown>;
}

export const typeSchemaRegistry: Record<DocumentType, TypeSchemaEntry> = {
  canonical: { schema: canonicalSchema, example: canonicalExample },
  decision: { schema: decisionSchema, example: decisionExample },
  note: { schema: noteSchema, example: noteExample },
  fact: { schema: factSchema, example: factExample },
  procedure: { schema: procedureSchema, example: procedureExample },
  entity: { schema: entitySchema, example: entityExample },
  artifact: { schema: artifactSchema, example: artifactExample },
};
```

- [ ] **Step 4: Run the tests — should pass**

```bash
npx vitest run src/lib/document-standard/type-schemas/__tests__/all-types.test.ts
```

Expected: PASS (~16 cases including the registry check).

- [ ] **Step 5: Commit**

```bash
git add src/lib/document-standard/type-schemas/
git commit -m "feat(document-standard): add per-type frontmatter Zod schemas"
```

---

## Task 6: Master document validator

**Files:**
- Create: `src/lib/taxonomy/types.ts` (prerequisite — small types file the validator imports)
- Create: `src/lib/document-standard/validate.ts`
- Create: `src/lib/document-standard/__tests__/validate.test.ts`

The master validator combines: universal schema + per-type schema + topic vocabulary check. Returns a single, flat error list.

The `taxonomy/types.ts` file lands here (rather than in Task 7 alongside the default-vocabulary content) so this task can red-green within itself rather than deferring its commit. Task 7 then adds the actual vocabulary data on top.

- [ ] **Step 1a: Create the taxonomy types file (no test — typing only)**

Create `src/lib/taxonomy/types.ts`:

```ts
// Persisted vocabulary shape — what lives in `brains.topic_vocabulary`
// (jsonb) and what `get_taxonomy` returns. Pure data, no behaviour.

export interface Vocabulary {
  /** Sorted (by spec order, not alphabetical) list of canonical terms. */
  terms: string[];
  /** Alias → canonical term. Empty for v1 if the workspace has not
   *  configured custom synonyms — the default map ships pre-populated. */
  synonyms: Record<string, string>;
  /** Vocabulary version. Bumped when an admin extends the list. v1
   *  default is 1. */
  version: number;
}
```

- [ ] **Step 1b: Write the failing validator test**

Create `src/lib/document-standard/__tests__/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateDocumentFrontmatter } from '../validate';

const vocabulary = {
  terms: ['brand', 'voice', 'pricing', 'customer'],
  synonyms: { users: 'customer' as const },
  version: 1,
};

const baseValid = {
  id: 'doc-001',
  title: 'Brand voice',
  type: 'canonical',
  source: 'human:angus',
  topics: ['brand', 'voice'],
  confidence: 'high',
  status: 'active',
  owner: 'angus',
  last_reviewed_at: '2026-04-01',
};

describe('validateDocumentFrontmatter', () => {
  it('accepts a fully valid canonical doc', () => {
    const result = validateDocumentFrontmatter(baseValid, vocabulary);
    expect(result.ok).toBe(true);
  });

  it('rejects when type-specific field is missing', () => {
    const { owner: _omit, ...rest } = baseValid;
    const result = validateDocumentFrontmatter(rest, vocabulary);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'owner')).toBe(true);
    }
  });

  it('rejects out-of-vocabulary topics with synonym hint when applicable', () => {
    const result = validateDocumentFrontmatter(
      { ...baseValid, topics: ['users'] },
      vocabulary,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const topicErr = result.errors.find((e) => e.field === 'topics');
      expect(topicErr).toBeTruthy();
      expect(topicErr?.message).toMatch(/customer/);
    }
  });

  it('rejects out-of-vocabulary topics with no hint when no synonym matches', () => {
    const result = validateDocumentFrontmatter(
      { ...baseValid, topics: ['novel-term'] },
      vocabulary,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'topics')).toBe(true);
    }
  });

  it('passes reserved types straight through (no per-type check)', () => {
    const reserved = {
      ...baseValid,
      type: 'skill',
    };
    // remove canonical-only owner to ensure reserved types skip per-type check.
    const { owner: _omit, last_reviewed_at: _omit2, ...rest } = reserved;
    const result = validateDocumentFrontmatter(rest, vocabulary);
    expect(result.ok).toBe(true);
  });

  it('aggregates errors across universal + type + topics', () => {
    const broken = {
      ...baseValid,
      confidence: 'super-high', // universal violation
      owner: '', // type-specific violation
      topics: ['unknown'], // vocabulary violation
    };
    const result = validateDocumentFrontmatter(broken, vocabulary);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = new Set(result.errors.map((e) => e.field));
      expect(fields.has('confidence')).toBe(true);
      expect(fields.has('owner')).toBe(true);
      expect(fields.has('topics')).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/lib/document-standard/__tests__/validate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

Create `src/lib/document-standard/validate.ts`:

```ts
// Master document-frontmatter validator. Combines:
//   - Universal schema (./universal-schema.ts) — id, title, type,
//     source, topics, confidence, status
//   - Per-type schema (./type-schemas/*) — type-specific fields
//   - Topic vocabulary check — every topic must be a canonical term
//
// Returns a single, flat ValidationError[] across all three layers so
// callers (write tools, Maintenance Agent step 1) can report
// everything wrong in one round trip.
//
// Reserved types (agent-scaffolding, agent-definition, skill) skip
// per-type validation — their schemas are owned by the agent / skill
// subsystems. Topic and universal validation still apply.

import { z } from 'zod';

import { isStandardType, isReservedType } from './constants';
import { validateUniversal, type ValidationError } from './universal-schema';
import { typeSchemaRegistry } from './type-schemas';

import type { Vocabulary } from '@/lib/taxonomy/types';

export type DocumentValidateResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] };

/**
 * Validate a parsed YAML frontmatter object against the document
 * standard. The vocabulary is required and is normally fetched once
 * per request via `getTaxonomy(brainId)`.
 */
export function validateDocumentFrontmatter(
  input: unknown,
  vocabulary: Vocabulary,
): DocumentValidateResult {
  const errors: ValidationError[] = [];

  // ---- Universal layer --------------------------------------------------
  const universal = validateUniversal(input);
  if (!universal.ok) {
    errors.push(...universal.errors);
    // Without a valid type we can't pick a per-type schema; skip that
    // layer but continue to topic check using whatever was in input.
  }

  // ---- Per-type layer --------------------------------------------------
  if (
    universal.ok &&
    isStandardType(universal.value.type) &&
    !isReservedType(universal.value.type)
  ) {
    const entry = typeSchemaRegistry[universal.value.type];
    const result = entry.schema.safeParse(input);
    if (!result.success) {
      errors.push(...flattenZod(result.error));
    }
  }
  // Reserved-type docs skip the per-type step (their schemas are
  // external to the document standard).

  // ---- Topic vocabulary layer ------------------------------------------
  const rawTopics =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>).topics
      : null;
  if (Array.isArray(rawTopics)) {
    const validTerms = new Set(vocabulary.terms);
    for (const t of rawTopics) {
      if (typeof t !== 'string') continue; // universal layer already complained
      if (validTerms.has(t)) continue;
      const synonym = vocabulary.synonyms[t];
      const hint = synonym
        ? `Use "${synonym}" instead.`
        : 'Out-of-vocabulary topic. Call get_taxonomy to see allowed terms.';
      errors.push({
        field: 'topics',
        message: `"${t}" is not in the workspace vocabulary. ${hint}`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as Record<string, unknown> };
}

function flattenZod(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? String(issue.path[0]) : '_',
    message: issue.message,
  }));
}
```

This validator imports from `@/lib/taxonomy/types` — created in step 1a above. The validator now red-greens within Task 6.

- [ ] **Step 4: Run the test — should pass**

```bash
npx vitest run src/lib/document-standard/__tests__/validate.test.ts
```

Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/taxonomy/types.ts \
        src/lib/document-standard/validate.ts \
        src/lib/document-standard/__tests__/validate.test.ts
git commit -m "feat(document-standard): add master frontmatter validator + Vocabulary type"
```

---

## Task 7: Default vocabulary constant

**Files:**
- Create: `src/lib/taxonomy/default-vocabulary.ts`
- Create: `src/lib/taxonomy/__tests__/default-vocabulary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/taxonomy/__tests__/default-vocabulary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOCABULARY,
  DEFAULT_TERMS,
  DEFAULT_SYNONYMS,
  TERM_DESCRIPTIONS,
} from '../default-vocabulary';

describe('default vocabulary', () => {
  it('has exactly 33 terms', () => {
    expect(DEFAULT_TERMS.length).toBe(33);
  });

  it('terms are unique', () => {
    expect(new Set(DEFAULT_TERMS).size).toBe(DEFAULT_TERMS.length);
  });

  it('every term has a non-empty description', () => {
    for (const t of DEFAULT_TERMS) {
      expect(TERM_DESCRIPTIONS[t].length).toBeGreaterThan(0);
    }
  });

  it('includes the spec-required cluster anchors', () => {
    for (const required of [
      'brand',
      'voice',
      'design',
      'positioning',
      'market',
      'competitor',
      'icp',
      'customer',
      'feedback',
      'support',
      'product',
      'pricing',
      'feature',
      'roadmap',
      'campaign',
      'content',
      'event',
      'sales',
      'partnership',
      'team',
      'hiring',
      'finance',
      'legal',
      'vendor',
      'strategy',
      'engineering',
      'architecture',
      'bug',
      'incident',
      'infra',
      'security',
      'release',
      'api',
    ]) {
      expect(DEFAULT_TERMS).toContain(required);
    }
  });

  it('synonyms map every alias to a canonical term', () => {
    for (const [alias, canonical] of Object.entries(DEFAULT_SYNONYMS)) {
      expect(DEFAULT_TERMS).toContain(canonical);
      expect(alias).not.toBe(canonical); // a term mapping to itself is noise
    }
  });

  it('includes spec-listed synonyms (sample)', () => {
    expect(DEFAULT_SYNONYMS['users']).toBe('customer');
    expect(DEFAULT_SYNONYMS['clients']).toBe('customer');
    expect(DEFAULT_SYNONYMS['accounts']).toBe('customer');
    expect(DEFAULT_SYNONYMS['prospect']).toBe('sales');
    expect(DEFAULT_SYNONYMS['lead']).toBe('sales');
    expect(DEFAULT_SYNONYMS['competition']).toBe('competitor');
    expect(DEFAULT_SYNONYMS['target audience']).toBe('icp');
    expect(DEFAULT_SYNONYMS['ux']).toBe('design');
    expect(DEFAULT_SYNONYMS['vulnerability']).toBe('security');
  });

  it('exports a packaged Vocabulary record', () => {
    expect(DEFAULT_VOCABULARY.terms).toEqual(DEFAULT_TERMS);
    expect(DEFAULT_VOCABULARY.synonyms).toEqual(DEFAULT_SYNONYMS);
    expect(DEFAULT_VOCABULARY.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/lib/taxonomy/__tests__/default-vocabulary.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the default vocabulary**

(The `Vocabulary` type was created as Task 6 step 1a; it's already importable from `@/lib/taxonomy/types`.)

Create `src/lib/taxonomy/default-vocabulary.ts`:

```ts
// The 33-term default vocabulary defined by
// docs/superpowers/specs/refined-focus/2026-04-25-tatara-default-topic-vocabulary.md.
//
// Order matches the spec's clustering, which also matches the order
// `get_taxonomy` returns terms in for deterministic display.

import type { Vocabulary } from './types';

export const DEFAULT_TERMS = [
  // Brand & identity (4)
  'brand',
  'voice',
  'design',
  'positioning',
  // Market (3)
  'market',
  'competitor',
  'icp',
  // Customer (3)
  'customer',
  'feedback',
  'support',
  // Product (4)
  'product',
  'pricing',
  'feature',
  'roadmap',
  // Marketing (3)
  'campaign',
  'content',
  'event',
  // Sales (2)
  'sales',
  'partnership',
  // People & operations (5)
  'team',
  'hiring',
  'finance',
  'legal',
  'vendor',
  // Strategy (1)
  'strategy',
  // Engineering & software (8)
  'engineering',
  'architecture',
  'bug',
  'incident',
  'infra',
  'security',
  'release',
  'api',
] as const;

export const TERM_DESCRIPTIONS: Record<(typeof DEFAULT_TERMS)[number], string> =
  {
    brand: 'Overall brand.',
    voice: 'Brand voice, tone of voice, copy style.',
    design: 'Visual identity, design system, brand assets.',
    positioning: 'How the company positions itself in the market.',
    market: 'Market analysis, market sizing, trends.',
    competitor: 'Competitive landscape, individual competitors.',
    icp: 'Ideal customer profile, target audience definitions.',
    customer: 'Customer accounts, customer-specific context.',
    feedback: 'Feedback, complaints, requests, testimonials.',
    support: 'Support workflows, ticket patterns, customer service.',
    product: 'Products, product strategy.',
    pricing: 'Pricing structure, plans, discounts, billing.',
    feature: 'Specific features, feature requests.',
    roadmap: 'Roadmap items, planned work, sequencing.',
    campaign: 'Marketing campaigns.',
    content: 'Content marketing, blog, copy assets, social posts.',
    event: 'Events, conferences, webinars, trade shows.',
    sales: 'Sales process, deals, pipeline.',
    partnership: 'Partner relationships, channel deals.',
    team: 'Internal team, roles, responsibilities.',
    hiring: 'Open roles, recruiting, candidate pipeline.',
    finance: 'Finance, budgeting, cash flow, expenses.',
    legal: 'Legal matters, contracts, IP, regulation.',
    vendor: 'Third-party vendors, tools, services.',
    strategy: 'Company strategy, OKRs, goals, planning.',
    engineering: 'Engineering team, culture, process, practices.',
    architecture: 'System architecture, ADRs, technical design decisions.',
    bug: 'Defects, regressions, customer-reported issues.',
    incident: 'Outages, postmortems, near-misses, on-call events.',
    infra: 'Infrastructure, hosting, platform, cloud, devops.',
    security: 'Vulnerabilities, audits, security policies.',
    release: 'Versioned shipping events, release notes.',
    api: 'API contracts, integrations, webhooks, third-party APIs.',
  };

/**
 * Alias → canonical term. Drawn from the spec's "synonym handling"
 * table. Lowercase keys; agents normalise their input before the
 * lookup.
 */
export const DEFAULT_SYNONYMS: Record<string, (typeof DEFAULT_TERMS)[number]> =
  {
    users: 'customer',
    clients: 'customer',
    accounts: 'customer',
    prospect: 'sales',
    lead: 'sales',
    competition: 'competitor',
    competitive: 'competitor',
    'target audience': 'icp',
    personas: 'icp',
    audience: 'icp',
    ux: 'design',
    ui: 'design',
    visual: 'design',
    tone: 'voice',
    'copy-style': 'voice',
    okr: 'strategy',
    kpi: 'strategy',
    goals: 'strategy',
    objectives: 'strategy',
    partner: 'partnership',
    affiliate: 'partnership',
    reseller: 'partnership',
    subscription: 'pricing',
    plans: 'pricing',
    billing: 'pricing',
    defect: 'bug',
    issue: 'bug',
    regression: 'bug',
    outage: 'incident',
    postmortem: 'incident',
    'incident-report': 'incident',
    'on-call': 'incident',
    infrastructure: 'infra',
    cloud: 'infra',
    hosting: 'infra',
    devops: 'infra',
    platform: 'infra',
    'system-design': 'architecture',
    adr: 'architecture',
    'technical-design': 'architecture',
    vulnerability: 'security',
    cve: 'security',
    pentest: 'security',
    audit: 'security',
    endpoint: 'api',
    webhook: 'api',
    integration: 'api',
    'third-party': 'api',
    version: 'release',
    'release-notes': 'release',
  };

export const DEFAULT_VOCABULARY: Vocabulary = {
  terms: [...DEFAULT_TERMS],
  synonyms: { ...DEFAULT_SYNONYMS },
  version: 1,
};
```

- [ ] **Step 4: Run the test — should pass**

```bash
npx vitest run src/lib/taxonomy/__tests__/default-vocabulary.test.ts
```

Expected: PASS (8 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/taxonomy/default-vocabulary.ts \
        src/lib/taxonomy/__tests__/default-vocabulary.test.ts
git commit -m "feat(taxonomy): add 33-term default vocabulary + synonym map"
```

---

## Task 8: Vocabulary getter + pure validator

**Files:**
- Create: `src/lib/taxonomy/get.ts`
- Create: `src/lib/taxonomy/validate.ts`
- Create: `src/lib/taxonomy/__tests__/validate.test.ts`

`getTaxonomy` reads from the database; `validateTopics` is pure.

- [ ] **Step 1: Write the failing test for the pure validator**

Create `src/lib/taxonomy/__tests__/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateTopics } from '../validate';

const vocab = {
  terms: ['brand', 'voice', 'pricing', 'customer'],
  synonyms: { users: 'customer' as const },
  version: 1,
};

describe('validateTopics', () => {
  it('accepts only canonical terms', () => {
    const result = validateTopics(['brand', 'voice'], vocab);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.canonical).toEqual(['brand', 'voice']);
  });

  it('reports synonym → canonical hint when alias used', () => {
    const result = validateTopics(['users'], vocab);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected).toEqual([
        { topic: 'users', synonymOf: 'customer' },
      ]);
    }
  });

  it('reports a bare rejection when nothing matches', () => {
    const result = validateTopics(['novel'], vocab);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected).toEqual([{ topic: 'novel', synonymOf: null }]);
    }
  });

  it('handles mixed valid + invalid in one pass', () => {
    const result = validateTopics(['brand', 'novel'], vocab);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejected.map((r) => r.topic)).toEqual(['novel']);
    }
  });

  it('rejects empty array as 0-of-1-to-5', () => {
    const result = validateTopics([], vocab);
    expect(result.ok).toBe(false);
  });

  it('rejects more than 5', () => {
    const result = validateTopics(
      ['brand', 'voice', 'pricing', 'customer', 'brand', 'voice'],
      vocab,
    );
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/lib/taxonomy/__tests__/validate.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure validator**

Create `src/lib/taxonomy/validate.ts`:

```ts
// Pure topics validator. Used by:
//   - The master document validator (./document-standard/validate.ts)
//   - Phase 3A's MCP write tools (when they enforce topic validity)
//
// No DB calls. The vocabulary blob is passed in by the caller — they
// are responsible for fetching it via `getTaxonomy(brainId)` once per
// request and reusing the result.

import type { Vocabulary } from './types';

export interface ValidateTopicsOk {
  ok: true;
  /** Topics in their canonical form. v1 is just a copy of input
   *  because we reject (rather than auto-normalise) aliases. Future
   *  versions may auto-normalise — keeping the field on the result
   *  shape now means callers won't need to change. */
  canonical: string[];
}

export interface ValidateTopicsRejection {
  topic: string;
  /** When non-null, the user's alias mapped to a canonical term —
   *  agents echo this back as a "did you mean X?" hint. */
  synonymOf: string | null;
}

export interface ValidateTopicsErr {
  ok: false;
  rejected: ValidateTopicsRejection[];
}

export type ValidateTopicsResult = ValidateTopicsOk | ValidateTopicsErr;

const MIN_TOPICS = 1;
const MAX_TOPICS = 5;

export function validateTopics(
  input: unknown,
  vocabulary: Vocabulary,
): ValidateTopicsResult {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      rejected: [{ topic: '_', synonymOf: null }],
    };
  }
  if (input.length < MIN_TOPICS || input.length > MAX_TOPICS) {
    return {
      ok: false,
      rejected: input
        .filter((t): t is string => typeof t === 'string')
        .map((t) => ({ topic: t, synonymOf: vocabulary.synonyms[t] ?? null })),
    };
  }

  const valid = new Set(vocabulary.terms);
  const rejected: ValidateTopicsRejection[] = [];
  for (const t of input) {
    if (typeof t !== 'string') {
      rejected.push({ topic: String(t), synonymOf: null });
      continue;
    }
    if (valid.has(t)) continue;
    rejected.push({ topic: t, synonymOf: vocabulary.synonyms[t] ?? null });
  }
  if (rejected.length > 0) return { ok: false, rejected };
  return { ok: true, canonical: [...input] };
}
```

- [ ] **Step 4: Run the validator test — should pass**

```bash
npx vitest run src/lib/taxonomy/__tests__/validate.test.ts
```

Expected: PASS (6 cases).

- [ ] **Step 5: Implement the DB getter**

Create `src/lib/taxonomy/get.ts`:

```ts
// Read the workspace vocabulary from `brains.topic_vocabulary`. Empty
// or missing returns the default — this is the canary case where a
// brain was created before the seed migration; treating it as "use
// defaults" lets the system stay functional during rollout.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { brains } from '@/db/schema';

import { DEFAULT_VOCABULARY } from './default-vocabulary';
import type { Vocabulary } from './types';

export async function getTaxonomy(brainId: string): Promise<Vocabulary> {
  const [row] = await db
    .select({ topicVocabulary: brains.topicVocabulary })
    .from(brains)
    .where(eq(brains.id, brainId))
    .limit(1);

  if (!row) {
    throw new Error(`brain not found: ${brainId}`);
  }

  const stored = row.topicVocabulary as Partial<Vocabulary> | null;

  if (
    stored &&
    Array.isArray(stored.terms) &&
    stored.terms.length > 0 &&
    typeof stored.version === 'number'
  ) {
    return {
      terms: stored.terms,
      synonyms: (stored.synonyms ?? {}) as Record<string, string>,
      version: stored.version,
    };
  }

  // Pre-seed brain — fall back to the default. The seed function
  // populates this on next provisioning; old brains are migrated by
  // re-running scripts/seed-builtins.ts (or the equivalent backfill).
  return DEFAULT_VOCABULARY;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/taxonomy/get.ts \
        src/lib/taxonomy/validate.ts \
        src/lib/taxonomy/__tests__/validate.test.ts
git commit -m "feat(taxonomy): add pure topic validator + getTaxonomy reader"
```

---

## Task 9: Vocabulary seed + brain provisioning hook

**Files:**
- Create: `src/lib/taxonomy/seed.ts`
- Create: `src/lib/taxonomy/__tests__/seed.test.ts`
- Modify: `src/lib/templates/seed.ts`
- Modify: `src/lib/templates/__tests__/seed.test.ts`

- [ ] **Step 1: Write the failing seed test**

Create `src/lib/taxonomy/__tests__/seed.test.ts`:

```ts
// Integration test — hits the live DB via the postgres superuser,
// following the pattern in src/__tests__/integration/helpers.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import { brains, companies } from '@/db/schema';
import { seedDefaultVocabulary } from '../seed';
import { DEFAULT_TERMS, DEFAULT_SYNONYMS } from '../default-vocabulary';

describe('seedDefaultVocabulary', () => {
  let companyId: string;
  let brainId: string;

  beforeAll(async () => {
    const slug = `tax-seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const [c] = await db
      .insert(companies)
      .values({ name: `Tax seed ${slug}`, slug })
      .returning({ id: companies.id });
    companyId = c.id;

    const [b] = await db
      .insert(brains)
      .values({
        companyId: c.id,
        name: 'Main',
        slug: 'main',
        description: 'Tax seed test',
      })
      .returning({ id: brains.id });
    brainId = b.id;
  });

  afterAll(async () => {
    if (brainId) await db.delete(brains).where(eq(brains.id, brainId));
    if (companyId)
      await db.delete(companies).where(eq(companies.id, companyId));
  });

  it('writes the 33-term vocabulary into brains.topic_vocabulary', async () => {
    await seedDefaultVocabulary(brainId);

    const [row] = await db
      .select({ vocab: brains.topicVocabulary })
      .from(brains)
      .where(eq(brains.id, brainId))
      .limit(1);

    expect(row).toBeTruthy();
    const v = row!.vocab as {
      terms: string[];
      synonyms: Record<string, string>;
      version: number;
    };
    expect(v.terms).toEqual(DEFAULT_TERMS);
    expect(v.synonyms).toEqual(DEFAULT_SYNONYMS);
    expect(v.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/lib/taxonomy/__tests__/seed.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the seed**

Create `src/lib/taxonomy/seed.ts`:

```ts
// Seed the workspace vocabulary at brain provisioning. Idempotent —
// re-runs overwrite the blob without any per-row teardown (this is
// jsonb on a single column, not a separate table). Suitable for
// backfill against existing brains that predate the migration.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { brains } from '@/db/schema';

import { DEFAULT_VOCABULARY } from './default-vocabulary';

export async function seedDefaultVocabulary(brainId: string): Promise<void> {
  await db
    .update(brains)
    .set({ topicVocabulary: DEFAULT_VOCABULARY })
    .where(eq(brains.id, brainId));
}
```

- [ ] **Step 4: Run the test — should pass**

```bash
npx vitest run src/lib/taxonomy/__tests__/seed.test.ts
```

Expected: PASS (1 case).

- [ ] **Step 5: Wire seedDefaultVocabulary into the brain provisioning path**

Modify `src/lib/templates/seed.ts`:

a. Add the import alongside existing imports at the top:

```ts
import { seedDefaultVocabulary } from '@/lib/taxonomy/seed';
```

b. Insert the call between the closing brace of `await db.transaction(...)` (currently the block ending around line 76) and the `await regenerateManifest(brainId);` line (currently line 81). New ordering:

```ts
  await db.transaction(async (tx) => {
    // ...existing folder + document inserts unchanged...
  });

  await seedDefaultVocabulary(brainId);   // ← NEW

  await regenerateManifest(brainId);
```

**Atomicity note (deliberate):** the seed is non-atomic with brain creation. A failed seed leaves the brain with an empty `topic_vocabulary` jsonb; `getTaxonomy()` (Task 8) detects that and falls back to `DEFAULT_VOCABULARY`, so retrieval keeps working. Re-running `seedDefaultVocabulary(brainId)` is idempotent (the `update` overwrites the jsonb blob), so a backfill script can repair affected brains without per-row teardown.

- [ ] **Step 6: Update the seed integration test**

Modify `src/lib/templates/__tests__/seed.test.ts`. The file declares `companyId` and `brainId` at module scope and uses module-level `beforeAll` / `afterAll` — append the new test inside the existing top-level `describe`:

```ts
it('seeds the default topic vocabulary into brains.topic_vocabulary', async () => {
  const [row] = await db
    .select({ vocab: brains.topicVocabulary })
    .from(brains)
    .where(eq(brains.id, brainId))
    .limit(1);
  const v = row!.vocab as { terms: string[]; version: number };
  expect(v.terms.length).toBe(33);
  expect(v.version).toBe(1);
});
```

**Coordination with Task 10:** Task 10 *rewrites* the existing folder-count assertion in this same file from "4 folders" to "7 folders". Task 9 only *appends* the vocabulary assertion. When you reach Task 10, preserve this vocabulary test — don't accidentally delete it as part of the rewrite. Read the file before each task to see the current state.

- [ ] **Step 7: Run the seed test suite**

```bash
npx vitest run src/lib/templates/__tests__/seed.test.ts \
              src/lib/taxonomy/__tests__/seed.test.ts
```

Expected: PASS for both.

- [ ] **Step 8: Commit**

```bash
git add src/lib/taxonomy/seed.ts \
        src/lib/taxonomy/__tests__/seed.test.ts \
        src/lib/templates/seed.ts \
        src/lib/templates/__tests__/seed.test.ts
git commit -m "feat(taxonomy): seed default vocabulary on brain provisioning"
```

---

## Task 10: Replace Universal Pack folders with the seven-spec layout

**Files:**
- Modify: `src/lib/templates/universal-pack.ts`
- Modify: `src/lib/templates/__tests__/seed.test.ts`

The current pack has four folders (`brand-identity`, `product-service`, `sales-revenue`, `company-operations`) with ten seeded "core" documents. The spec replaces this with the seven folders (`/company`, `/customers`, `/market`, `/product`, `/marketing`, `/operations`, `/signals`). For v1, ship only the folder structure — no seeded documents (the founder authors via MCP, and pre-seeded canonical drafts from the old pack would now violate the new doc standard's frontmatter requirement).

This is a deliberate cut: emptiness in `/operations` on day one is preferable to ten seed docs that fail the validator.

- [ ] **Step 1: Update the test first (red)**

Modify `src/lib/templates/__tests__/seed.test.ts`. Find the existing assertions about the seeded folders (likely a count or specific slug check) and replace them with the seven-folder expectation:

```ts
it('creates the seven document-standard folders at the top level', async () => {
  const rows = await db
    .select({ slug: folders.slug, parentId: folders.parentId })
    .from(folders)
    .where(eq(folders.brainId, brainId));
  const top = rows.filter((r) => r.parentId === null).map((r) => r.slug).sort();
  expect(top).toEqual([
    'company',
    'customers',
    'market',
    'marketing',
    'operations',
    'product',
    'signals',
  ]);
});

it('does not seed any documents (v1 starts empty)', async () => {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.brainId, brainId));
  expect(rows).toEqual([]);
});
```

(Adjust imports and the surrounding describe/before scaffolding to match what's already in that file.)

- [ ] **Step 2: Run the failing tests**

```bash
npx vitest run src/lib/templates/__tests__/seed.test.ts
```

Expected: FAIL — old pack still creates 4 folders + 10 docs.

- [ ] **Step 3: Rewrite universal-pack.ts**

Replace the entire content of `src/lib/templates/universal-pack.ts` with:

```ts
// Universal Base Pack — the seed layout every new brain ships with.
//
// v1 (refined-focus): seven top-level folders matching the Tatara
// Document Standard v1 spec. No seeded documents — the founder
// authors content via MCP, and the document-standard validator
// requires every committed doc to have valid universal + per-type
// frontmatter, which a generic pre-seed cannot satisfy.
//
// The TEMPLATE-AS-MARKDOWN approach used in the prior pack (10 H2
// "fill me in" stubs) is incompatible with the new doc standard: the
// validator would reject them as missing required type-specific
// fields. Better to ship clean and let the founder fill the brain in
// their own voice from the first MCP write.

export interface FolderTemplate {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  parentId: null;
}

export const UNIVERSAL_PACK = {
  id: 'universal',
  name: 'Universal Base Pack v1',
  folders: [
    {
      slug: 'company',
      name: 'Company',
      description:
        'Brand voice, brand/design, mission, values, internal team, roles, structure.',
      sortOrder: 10,
      parentId: null,
    },
    {
      slug: 'customers',
      name: 'Customers',
      description:
        'Customer accounts, contacts, conversations, feedback, account-level pricing.',
      sortOrder: 20,
      parentId: null,
    },
    {
      slug: 'market',
      name: 'Market',
      description:
        'ICPs, competitive landscape, positioning, market research.',
      sortOrder: 30,
      parentId: null,
    },
    {
      slug: 'product',
      name: 'Product',
      description:
        'Products, pricing, roadmap, technical architecture, product research.',
      sortOrder: 40,
      parentId: null,
    },
    {
      slug: 'marketing',
      name: 'Marketing',
      description:
        'Campaigns, email sequences, website copy, social content, events.',
      sortOrder: 50,
      parentId: null,
    },
    {
      slug: 'operations',
      name: 'Operations',
      description: 'Procedures, policies, tools, vendors.',
      sortOrder: 60,
      parentId: null,
    },
    {
      slug: 'signals',
      name: 'Signals',
      description:
        'Time-stamped raw input: rambles, meeting notes, slack captures, in-flight thoughts.',
      sortOrder: 70,
      parentId: null,
    },
  ] satisfies FolderTemplate[],

  // No seed documents in v1 — see header comment.
  documents: [] as const,
} as const;
```

- [ ] **Step 4: Update src/lib/templates/seed.ts to handle the empty documents array**

Read `src/lib/templates/seed.ts` again and confirm the `for (const tmpl of UNIVERSAL_PACK.documents)` loop is a no-op when documents is empty. It should be — the loop just doesn't execute. No code change needed beyond what Task 9 already did.

- [ ] **Step 5: Run the seed tests — should pass**

```bash
npx vitest run src/lib/templates/__tests__/seed.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run any callers that referenced the old folder slugs**

```bash
npx vitest run
```

Other tests (e.g., manifest tests, integration tests, scaffolding tests) may have hard-coded the old folder slugs (`brand-identity`, etc.). Find and update each that's now red. Use grep to locate them:

```bash
grep -rln "brand-identity\|product-service\|sales-revenue\|company-operations" \
  src/ docs/ scripts/
```

For each match in `src/**/*.test.ts` or `src/**/*.test.tsx`:
- If the test goes through `seedBrainFromUniversalPack` (or otherwise depends on the seed pack's folder slugs), update fixture slugs to one of the new seven folders.
- If the test creates folders manually (e.g., `src/lib/brain/__tests__/manifest.fixtures.ts`, `src/lib/brain/__tests__/manifest.nested.test.ts`, `src/lib/tools/__tests__/search-documents.test.ts`), the slugs are self-contained — they don't depend on the universal pack and don't need updating to keep the test green. You may rename them cosmetically for consistency, but it's optional.
- Re-run the affected file: `npx vitest run <path>`.

For non-test matches in `src/**`: those are bugs — the old slugs no longer exist post-seed. Update to the new slugs or remove if they're stale.

For matches in `docs/` or `scripts/`: skim and update only if the file is still load-bearing for current behaviour. Decommissioned docs can stay as historical record.

- [ ] **Step 7: Commit**

```bash
git add src/lib/templates/universal-pack.ts \
        src/lib/templates/__tests__/seed.test.ts \
        # plus any other files touched by step 6
git commit -m "feat(templates): replace 4-folder pack with 7-folder document-standard layout"
```

---

## Task 11: get_taxonomy MCP tool

**Files:**
- Create: `src/lib/tools/implementations/get-taxonomy.ts`
- Create: `src/lib/tools/implementations/__tests__/get-taxonomy.test.ts`
- Modify: `src/lib/tools/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tools/implementations/__tests__/get-taxonomy.test.ts`. The test follows the existing pattern in `src/__tests__/integration/mvp-mcp-in-read.test.ts`: use `cleanupCompany` for teardown (NOT a fictional `destroySeededCompany`), and build a full `ToolContext` matching `src/lib/tools/types.ts:61` (which requires `actor.scopes`, `grantedCapabilities`, `webCallsThisTurn`):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cleanupCompany,
  createSeededCompany,
  type TestCompany,
} from '@/__tests__/integration/helpers';
import { executeTool } from '@/lib/tools/executor';
import { registerLocusTools } from '@/lib/tools';
import type { ToolContext } from '@/lib/tools/types';
import { getTaxonomyTool } from '../get-taxonomy';
import { FOLDERS, DOCUMENT_TYPES } from '@/lib/document-standard/constants';

describe('get_taxonomy tool', () => {
  let ctx: TestCompany;

  beforeAll(async () => {
    ctx = await createSeededCompany('get-tax');
    registerLocusTools();
  }, 60_000);

  afterAll(async () => {
    if (ctx) await cleanupCompany(ctx);
  }, 60_000);

  function buildContext(): ToolContext {
    return {
      actor: {
        type: 'agent_token',
        id: 'test-token-id',
        scopes: ['read'],
      },
      companyId: ctx.companyId,
      brainId: ctx.brainId,
      tokenId: 'test-token-id',
      grantedCapabilities: [],
      webCallsThisTurn: 0,
    };
  }

  it('is read-only', () => {
    expect(getTaxonomyTool.isReadOnly()).toBe(true);
  });

  it('returns folders, types, topics, and source_format', async () => {
    const result = await executeTool('get_taxonomy', {}, buildContext());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.folders.map((f: { slug: string }) => f.slug)).toEqual(
      FOLDERS,
    );
    expect(result.data.types.map((t: { type: string }) => t.type)).toEqual(
      DOCUMENT_TYPES,
    );
    expect(result.data.topics.length).toBe(33);
    expect(result.data.source_format).toMatch(/agent:/);
    expect(result.data.source_format).toMatch(/human:/);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/lib/tools/implementations/__tests__/get-taxonomy.test.ts
```

Expected: FAIL — tool not found.

- [ ] **Step 3: Implement the tool**

Create `src/lib/tools/implementations/get-taxonomy.ts`:

```ts
// get_taxonomy — discovery tool for external agents.
//
// Returns the workspace's folders (slugs + descriptions), document
// types (names + descriptions), allowed topic vocabulary, and the
// source-format hint. Cacheable for the duration of a session;
// taxonomy changes infrequently.
//
// Tool description copy is the literal product surface — see
// docs/superpowers/specs/refined-focus/2026-04-25-tatara-mcp-tool-surface.md.

import {
  FOLDERS,
  FOLDER_DESCRIPTIONS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_DESCRIPTIONS,
  SOURCE_PREFIXES,
} from '@/lib/document-standard/constants';
import { getTaxonomy } from '@/lib/taxonomy/get';
import { TERM_DESCRIPTIONS } from '@/lib/taxonomy/default-vocabulary';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface GetTaxonomyOutput {
  folders: { slug: string; description: string }[];
  types: { type: string; description: string }[];
  topics: { term: string; description: string }[];
  synonyms: Record<string, string>;
  source_format: string;
}

export const getTaxonomyTool: LocusTool<{}, GetTaxonomyOutput> = {
  name: 'get_taxonomy',
  description:
    "Returns the workspace's allowed folders, document types, and topic " +
    'vocabulary. Cache the result for the duration of your session — taxonomy ' +
    'changes infrequently. Call once at the start of any session that may ' +
    'write to the brain. Without taxonomy, you cannot construct valid documents.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  action: 'read' as const,
  resourceType: 'document' as const,

  isReadOnly() {
    return true;
  },

  async call(
    _input: {},
    context: ToolContext,
  ): Promise<ToolResult<GetTaxonomyOutput>> {
    const vocab = await getTaxonomy(context.brainId);

    return {
      success: true,
      data: {
        folders: FOLDERS.map((slug) => ({
          slug,
          description: FOLDER_DESCRIPTIONS[slug],
        })),
        types: DOCUMENT_TYPES.map((type) => ({
          type,
          description: DOCUMENT_TYPE_DESCRIPTIONS[type],
        })),
        topics: vocab.terms.map((term) => ({
          term,
          // TERM_DESCRIPTIONS only covers default terms; admin-extended
          // terms (out of scope for v1) get an empty description until
          // the admin UI captures them.
          description:
            (TERM_DESCRIPTIONS as Record<string, string>)[term] ?? '',
        })),
        synonyms: vocab.synonyms,
        source_format: `Use "${SOURCE_PREFIXES[0]}<your-name>" if you are an agent (e.g., "agent:claude-code"), or "${SOURCE_PREFIXES[1]}<username>" if you are a human (e.g., "human:angus").`,
      },
      metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
    };
  },
};
```

- [ ] **Step 4: Register the tool**

Modify `src/lib/tools/index.ts`:

```ts
import { getTaxonomyTool } from './implementations/get-taxonomy';
```

Inside `registerLocusTools()`, add to the read-tools block:

```ts
  registerTool(getTaxonomyTool);
```

Re-export it at the bottom of the file:

```ts
export {
  // ...existing exports...
  getTaxonomyTool,
};
```

- [ ] **Step 5: Run the test — should pass**

```bash
npx vitest run src/lib/tools/implementations/__tests__/get-taxonomy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tools/implementations/get-taxonomy.ts \
        src/lib/tools/implementations/__tests__/get-taxonomy.test.ts \
        src/lib/tools/index.ts
git commit -m "feat(tools): add get_taxonomy MCP read tool"
```

---

## Task 12: get_type_schema MCP tool

**Files:**
- Create: `src/lib/tools/implementations/get-type-schema.ts`
- Create: `src/lib/tools/implementations/__tests__/get-type-schema.test.ts`
- Modify: `src/lib/tools/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tools/implementations/__tests__/get-type-schema.test.ts`. Same `ToolContext` shape as Task 11:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cleanupCompany,
  createSeededCompany,
  type TestCompany,
} from '@/__tests__/integration/helpers';
import { executeTool } from '@/lib/tools/executor';
import { registerLocusTools } from '@/lib/tools';
import type { ToolContext } from '@/lib/tools/types';
import { getTypeSchemaTool } from '../get-type-schema';

describe('get_type_schema tool', () => {
  let ctx: TestCompany;

  beforeAll(async () => {
    ctx = await createSeededCompany('get-type');
    registerLocusTools();
  }, 60_000);

  afterAll(async () => {
    if (ctx) await cleanupCompany(ctx);
  }, 60_000);

  function buildContext(): ToolContext {
    return {
      actor: {
        type: 'agent_token',
        id: 'test-token-id',
        scopes: ['read'],
      },
      companyId: ctx.companyId,
      brainId: ctx.brainId,
      tokenId: 'test-token-id',
      grantedCapabilities: [],
      webCallsThisTurn: 0,
    };
  }

  it('is read-only', () => {
    expect(getTypeSchemaTool.isReadOnly()).toBe(true);
  });

  it('returns required + optional fields and an example for canonical', async () => {
    const result = await executeTool(
      'get_type_schema',
      { type: 'canonical' },
      buildContext(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data.required_fields)).toEqual(
      expect.arrayContaining(['owner', 'last_reviewed_at']),
    );
    expect(result.data.examples.length).toBeGreaterThan(0);
  });

  it('rejects an unknown type with invalid_input', async () => {
    const result = await executeTool(
      'get_type_schema',
      { type: 'novel-type' },
      buildContext(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      // Note: the executor's ajv validation rejects with `invalid_input`
      // (lowercase) before the tool's call() runs, since the JSON schema
      // declares `type` as enum. The tool's own INVALID_INPUT branch is
      // unreachable from this path, but kept in the implementation as
      // belt-and-braces for callers that bypass the executor.
      expect(result.error.code).toBe('invalid_input');
    }
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npx vitest run src/lib/tools/implementations/__tests__/get-type-schema.test.ts
```

Expected: FAIL — tool not found.

- [ ] **Step 3: Implement the tool**

Create `src/lib/tools/implementations/get-type-schema.ts`:

```ts
// get_type_schema — returns the frontmatter schema for one of the
// seven standard document types. The output shape is denormalised
// from the per-type Zod schemas so external agents can read field
// names + value constraints without parsing Zod internals.

import { z } from 'zod';

import {
  DOCUMENT_TYPES,
  isStandardType,
  type DocumentType,
} from '@/lib/document-standard/constants';
import { typeSchemaRegistry } from '@/lib/document-standard/type-schemas';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface GetTypeSchemaInput {
  type: string;
}

interface FieldSpec {
  description: string;
  value_constraint: string;
}

interface GetTypeSchemaOutput {
  type: DocumentType;
  required_fields: Record<string, FieldSpec>;
  optional_fields: Record<string, FieldSpec>;
  examples: Record<string, unknown>[];
}

export const getTypeSchemaTool: LocusTool<
  GetTypeSchemaInput,
  GetTypeSchemaOutput
> = {
  name: 'get_type_schema',
  description:
    'Returns the YAML frontmatter schema for a given document type — required ' +
    'fields, optional fields, and value constraints. Call before writing a ' +
    'document of a type you have not written before in this session. ' +
    `Type must be one of: ${DOCUMENT_TYPES.join(', ')}.`,
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...DOCUMENT_TYPES] },
    },
    required: ['type'],
    additionalProperties: false,
  },

  action: 'read' as const,
  resourceType: 'document' as const,

  isReadOnly() {
    return true;
  },

  async call(
    input: GetTypeSchemaInput,
    _context: ToolContext,
  ): Promise<ToolResult<GetTypeSchemaOutput>> {
    if (!isStandardType(input.type)) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: `Unknown type "${input.type}". Use get_taxonomy to list valid types.`,
          hint: `Valid types: ${DOCUMENT_TYPES.join(', ')}`,
          retryable: false,
        },
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      };
    }

    const entry = typeSchemaRegistry[input.type];
    const { required, optional } = describeZodObject(
      entry.schema as z.ZodObject<z.ZodRawShape>,
    );

    return {
      success: true,
      data: {
        type: input.type,
        required_fields: required,
        optional_fields: optional,
        examples: [entry.example],
      },
      metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
    };
  },
};

/**
 * Walk a Zod object schema and produce human-readable field specs. The
 * output isn't a full JSON Schema — it's a flat description aimed at an
 * LLM agent constructing a frontmatter block.
 */
function describeZodObject(schema: z.ZodObject<z.ZodRawShape>): {
  required: Record<string, FieldSpec>;
  optional: Record<string, FieldSpec>;
} {
  const required: Record<string, FieldSpec> = {};
  const optional: Record<string, FieldSpec> = {};

  const shape = schema.shape;
  for (const [name, fieldSchema] of Object.entries(shape)) {
    const isOptional = fieldSchema instanceof z.ZodOptional;
    const inner = isOptional
      ? (fieldSchema as z.ZodOptional<z.ZodTypeAny>)._def.innerType
      : fieldSchema;
    const spec: FieldSpec = {
      description: '',
      value_constraint: describeZodType(inner),
    };
    if (isOptional) optional[name] = spec;
    else required[name] = spec;
  }
  return { required, optional };
}

function describeZodType(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodEnum) {
    return `one of: ${(schema._def.values as readonly string[]).join(', ')}`;
  }
  if (schema instanceof z.ZodArray) {
    return `array of ${describeZodType(schema._def.type)}`;
  }
  return 'value';
}
```

- [ ] **Step 4: Register the tool**

Modify `src/lib/tools/index.ts`:

```ts
import { getTypeSchemaTool } from './implementations/get-type-schema';
```

Inside `registerLocusTools()` near the other read tools:

```ts
  registerTool(getTypeSchemaTool);
```

Re-export at the bottom:

```ts
export {
  // ...existing exports...
  getTypeSchemaTool,
};
```

- [ ] **Step 5: Run the test — should pass**

```bash
npx vitest run src/lib/tools/implementations/__tests__/get-type-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tools/implementations/get-type-schema.ts \
        src/lib/tools/implementations/__tests__/get-type-schema.test.ts \
        src/lib/tools/index.ts
git commit -m "feat(tools): add get_type_schema MCP read tool"
```

---

## Task 13: Extend search_documents with type/folder/topics/confidence_min filters

**Files:**
- Modify: `src/lib/tools/implementations/search-documents.ts`
- Modify: `src/lib/tools/implementations/__tests__/search-documents.test.ts`
- Modify: `src/lib/mcp/tools.ts` (rename `category` → `folder` in the MCP-level Zod schema)

The spec adds three new filters (`type`, `topics`, `confidence_min`) and renames `category` → `folder` at the MCP boundary. **Important:** the *internal* tool already uses `folder` — only the MCP-level Zod schema and tool description in `src/lib/mcp/tools.ts` still say `category`. The internal-tool rename is a non-event.

- [ ] **Step 1: Read the existing implementation**

Read `src/lib/tools/implementations/search-documents.ts` end-to-end. The tool delegates to `tataraHybridProvider.retrieve()` — it does NOT build SQL directly. So the new filters are applied either:
- (a) by extending the provider's `filters` shape and pushing them into the underlying retrieval query, OR
- (b) by post-filtering the provider's results inside the tool.

For Phase 1 simplicity, this plan uses **(b) post-filter**. The retrieval cardinality is already low (default 10, max 50), and post-filtering keeps the provider's contract unchanged. If a later phase shows post-filter cuts the result count below useful, push the filters into the provider then. Mark this as a known trade-off in the implementation comment.

For the four filters:
- `folder` — already supported by the provider via `filters.folderPath`. No change to filter wiring; only the input plumbing (renaming the MCP-level Zod key from `category` to `folder` is already done at the internal-tool layer; the MCP layer needs the rename).
- `type` — post-filter on `result.metadata.type` (or the equivalent field the provider surfaces; check the `Provenance` shape if uncertain).
- `topics` — post-filter on `result.metadata.topics` (contains-all semantics: every requested topic must be in the doc's topics).
- `confidence_min` — post-filter on `result.metadata.confidence` mapped to a numeric rank.

Read `src/lib/memory/providers/tatara-hybrid/index.ts` (or its `index.ts` equivalent) briefly to confirm what fields each result row exposes — adjust the post-filter access path if the field name differs.

- [ ] **Step 2: Update the test**

Modify `src/lib/tools/implementations/__tests__/search-documents.test.ts`. Add cases for each new filter; update any case that uses `category` to use `folder`. Skeleton:

```ts
it('filters by folder slug', async () => {
  // Insert two docs into different folders, search with folder filter,
  // assert only the matching folder's doc returns.
});

it('filters by document type', async () => {
  // Insert a canonical and a note doc; filter by type='canonical';
  // assert only canonical returns.
});

it('filters by topics (contains-all semantics)', async () => {
  // Insert {topics: [brand, voice]} and {topics: [brand]};
  // filter by topics: ['brand', 'voice'];
  // assert only the first returns.
});

it('filters by confidence_min=medium (returns medium + high)', async () => {
  // Insert docs at low/medium/high; filter with confidence_min='medium';
  // assert only medium + high return.
});
```

(Match the existing fixture style in the file for inserts and brain setup.)

- [ ] **Step 3: Run failing tests**

```bash
npx vitest run src/lib/tools/implementations/__tests__/search-documents.test.ts
```

Expected: FAIL on the new cases.

- [ ] **Step 4: Implement the filter changes (post-filter approach)**

In `src/lib/tools/implementations/search-documents.ts`:

a. Update the input interface:

```ts
import { DOCUMENT_TYPES } from '@/lib/document-standard/constants';

interface SearchDocumentsInput {
  query: string;
  folder?: string;
  type?: string;
  topics?: string[];
  confidence_min?: 'low' | 'medium' | 'high';
  max_results?: number;
}
```

b. Update the JSON Schema in `inputSchema`:

```ts
inputSchema: {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1 },
    folder: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: [...DOCUMENT_TYPES] },
    topics: { type: 'array', items: { type: 'string' }, minItems: 1 },
    confidence_min: { type: 'string', enum: ['low', 'medium', 'high'] },
    max_results: { type: 'integer', minimum: 1, maximum: 50 },
  },
  required: ['query'],
  additionalProperties: false,
},
```

c. Update the result shape and post-filter logic. The provider returns `RankedResult` (`src/lib/memory/types.ts:72`), which has `documentId`, `title`, `score`, `provenance`, `snippet` — but **does not surface `documents.type`, `documents.topics`, or `documents.confidenceLevel`**. So a single follow-up `SELECT` joins those fields keyed by `documentId` before post-filtering. Cardinality is ≤50, so the join is cheap.

Replace the `SearchResult` interface and the `call()` body:

```ts
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema';

interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  relevance_score: number;
  folder: string | null;
  type: string | null;
  topics: string[];
  confidence: 'low' | 'medium' | 'high' | null;
  provenance: Provenance;
}

interface SearchDocumentsOutput {
  query: string;
  results: SearchResult[];
}

// ...inside call():
async call(
  input: SearchDocumentsInput,
  context: ToolContext,
): Promise<ToolResult<SearchDocumentsOutput>> {
  // Provider gives us ranked results; we then SELECT the doc-level
  // fields the new filters need (type/topics/confidence) and post-
  // filter. Acceptable for v1 because retrieval cardinality is small
  // (max 50). If post-filter cuts the result count uncomfortably,
  // push these into the provider's filter shape in a later phase.
  const raw = await tataraHybridProvider.retrieve({
    brainId: context.brainId,
    companyId: context.companyId,
    query: input.query,
    mode: 'hybrid',
    tierCeiling: 'extracted',
    limit: input.max_results ?? 10,
    filters: input.folder ? { folderPath: input.folder } : undefined,
  });

  if (raw.length === 0) {
    return {
      success: true,
      data: { query: input.query, results: [] },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: [],
        details: {
          eventType: 'document.search',
          folder: input.folder ?? null,
          type: input.type ?? null,
          topics: input.topics ?? null,
          confidence_min: input.confidence_min ?? null,
          resultCount: 0,
          query: input.query,
        },
      },
    };
  }

  // Single follow-up SELECT to fetch the doc-standard fields by id.
  // Builds a Map for O(1) lookup during post-filter + shaping.
  const docIds = raw.map((r) => r.documentId);
  const docRows = await db
    .select({
      id: documents.id,
      type: documents.type,
      topics: documents.topics,
      confidenceLevel: documents.confidenceLevel,
    })
    .from(documents)
    .where(inArray(documents.id, docIds));

  const docFields = new Map(
    docRows.map((d) => [
      d.id,
      {
        type: d.type,
        topics: (d.topics ?? []) as string[],
        confidence: d.confidenceLevel as 'low' | 'medium' | 'high',
      },
    ]),
  );

  const rank = (l: string | null): number =>
    l === 'high' ? 3 : l === 'medium' ? 2 : l === 'low' ? 1 : 0;
  const minRank = input.confidence_min ? rank(input.confidence_min) : 0;

  const filtered = raw.filter((r) => {
    const fields = docFields.get(r.documentId);
    if (!fields) return false; // doc was deleted between retrieve and select
    if (input.type && fields.type !== input.type) return false;
    if (input.topics && input.topics.length > 0) {
      if (!input.topics.every((t) => fields.topics.includes(t))) return false;
    }
    if (input.confidence_min && rank(fields.confidence) < minRank) {
      return false;
    }
    return true;
  });

  const shaped: SearchResult[] = filtered.map((r) => {
    const fields = docFields.get(r.documentId)!; // present — checked above
    return {
      path: r.provenance.path,
      title: r.title,
      snippet: r.snippet.text,
      relevance_score: r.score,
      folder: extractFolderFromPath(r.provenance.path),
      type: fields.type,
      topics: fields.topics,
      confidence: fields.confidence,
      provenance: r.provenance,
    };
  });

  return {
    success: true,
    data: { query: input.query, results: shaped },
    metadata: {
      responseTokens: 0,
      executionMs: 0,
      documentsAccessed: filtered.map((r) => r.documentId),
      details: {
        eventType: 'document.search',
        folder: input.folder ?? null,
        type: input.type ?? null,
        topics: input.topics ?? null,
        confidence_min: input.confidence_min ?? null,
        resultCount: shaped.length,
        query: input.query,
      },
    },
  };
},
```

d. The internal description string (the `description` property on `searchDocumentsTool`) doesn't need to mention specific filters — those live in the JSON schema. Leave the description short, OR optionally rephrase to match the spec's MCP-tool wording (lifted into Step 6 below).

- [ ] **Step 5: Run tests — should pass**

```bash
npx vitest run src/lib/tools/implementations/__tests__/search-documents.test.ts
```

Expected: PASS for all cases (existing + four new).

- [ ] **Step 6: Update the MCP tool description in `src/lib/mcp/tools.ts`**

Find the `search_documents` registration in `src/lib/mcp/tools.ts`. Replace the description with the spec wording:

```ts
server.tool(
  'search_documents',
  'Full-text and semantic search across the Tatara brain. Returns ranked ' +
    'results with snippets, document ids, types, and confidence levels. ' +
    'Use when you need to locate information by content rather than by known ' +
    'path. Always run a search before proposing a new document — duplicates ' +
    'are common and the Maintenance Agent will flag them. ' +
    'Filters: type (canonical | decision | note | fact | procedure | entity | artifact), ' +
    'folder (/company | /customers | /market | /product | /marketing | /operations | /signals), ' +
    'topics (array of topic tags), confidence_min (low | medium | high), ' +
    'max_results (1–50, default 10).',
  {
    query: z.string().min(1),
    folder: z.string().optional(),
    type: z.string().optional(),
    topics: z.array(z.string()).optional(),
    confidence_min: z.enum(['low', 'medium', 'high']).optional(),
    max_results: z.number().int().min(1).max(50).optional(),
  },
  async (input) =>
    handleToolCall({
      toolName: 'search_documents',
      rawInput: input,
      request,
    }),
);
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/tools/implementations/search-documents.ts \
        src/lib/tools/implementations/__tests__/search-documents.test.ts \
        src/lib/mcp/tools.ts
git commit -m "feat(tools): extend search_documents with type/folder/topics/confidence_min filters"
```

---

## Task 14: Expose get_taxonomy + get_type_schema via MCP IN

**Files:**
- Modify: `src/lib/mcp/handler.ts`
- Modify: `src/lib/mcp/tools.ts`
- Modify: `src/__tests__/integration/mvp-mcp-in-read.test.ts`

The MCP IN handler maintains an explicit `MCP_ALLOWED_TOOLS` allowlist (defence-in-depth). Both new read tools must be added; both also need `server.tool(...)` registration.

- [ ] **Step 1: Update the MCP integration test (red)**

Modify `src/__tests__/integration/mvp-mcp-in-read.test.ts`. The file already imports `handleToolCall` from `@/lib/mcp/handler` and defines a local `mcpRequest()` helper that builds an authenticated `Request` object (see lines 28, 55–64 of the existing file). Add new tests inside the existing top-level describe, following that pattern:

```ts
it('exposes get_taxonomy as a read tool over MCP IN', async () => {
  const response = await handleToolCall({
    toolName: 'get_taxonomy',
    rawInput: {},
    request: mcpRequest(),
  });
  // The MCP handler returns a McpToolResponse where `content[0].text`
  // is the JSON-stringified tool result data. Parse and assert.
  expect(response.isError).toBeFalsy();
  const data = JSON.parse(response.content[0].text);
  expect(data.folders.length).toBe(7);
  expect(data.types.length).toBe(7);
  expect(data.topics.length).toBe(33);
});

it('exposes get_type_schema as a read tool over MCP IN', async () => {
  const response = await handleToolCall({
    toolName: 'get_type_schema',
    rawInput: { type: 'canonical' },
    request: mcpRequest(),
  });
  expect(response.isError).toBeFalsy();
  const data = JSON.parse(response.content[0].text);
  expect(Object.keys(data.required_fields)).toEqual(
    expect.arrayContaining(['owner', 'last_reviewed_at']),
  );
});
```

(Confirm the `response.content[0].text` parse pattern by reading any existing integration test that already calls `handleToolCall` and unpacks the result — match the pattern verbatim. If `formatMcpResponse` wraps differently, adjust the parse step.)

- [ ] **Step 2: Run failing tests**

```bash
npx vitest run src/__tests__/integration/mvp-mcp-in-read.test.ts
```

Expected: FAIL — tools not exposed yet.

- [ ] **Step 3: Update the MCP allowlist**

In `src/lib/mcp/handler.ts`, extend `MCP_ALLOWED_TOOLS`:

```ts
export const MCP_ALLOWED_TOOLS = new Set<string>([
  'search_documents',
  'get_document',
  'get_document_diff',
  'get_diff_history',
  'get_taxonomy',
  'get_type_schema',
]);
```

- [ ] **Step 4: Register the tools on the MCP server**

In `src/lib/mcp/tools.ts`, after the existing four `server.tool(...)` calls, add the two new ones with the spec wording:

```ts
server.tool(
  'get_taxonomy',
  "Returns the workspace's allowed folders, document types, and topic " +
    'vocabulary. Cache the result for the duration of your session — ' +
    'taxonomy changes infrequently. Call once at the start of any session ' +
    'that may write to the brain. Without taxonomy, you cannot construct ' +
    'valid documents. Returns: folders (slug + description), types (name + ' +
    'description), topics (controlled vocabulary), source_format (how to ' +
    'format the source field).',
  {},
  async (input) =>
    handleToolCall({
      toolName: 'get_taxonomy',
      rawInput: input,
      request,
    }),
);
registered.add('get_taxonomy');

server.tool(
  'get_type_schema',
  'Returns the YAML frontmatter schema for a given document type — required ' +
    'fields, optional fields, and value constraints. Call before writing a ' +
    'document of a type you have not written before in this session. Type ' +
    'must be one of: canonical, decision, note, fact, procedure, entity, artifact.',
  {
    type: z.enum([
      'canonical',
      'decision',
      'note',
      'fact',
      'procedure',
      'entity',
      'artifact',
    ]),
  },
  async (input) =>
    handleToolCall({
      toolName: 'get_type_schema',
      rawInput: input,
      request,
    }),
);
registered.add('get_type_schema');
```

The `registered.add(...)` calls are part of the existing parity check at the bottom of `registerMcpTools()`; matching new entries on both sides keeps the assertion green.

- [ ] **Step 5: Run failing tests — should pass**

```bash
npx vitest run src/__tests__/integration/mvp-mcp-in-read.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the broader MCP test surface**

```bash
npx vitest run src/lib/mcp/__tests__/
```

Expected: PASS. The parity check between `MCP_ALLOWED_TOOLS` and `registerMcpTools` should be satisfied.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp/handler.ts \
        src/lib/mcp/tools.ts \
        src/__tests__/integration/mvp-mcp-in-read.test.ts
git commit -m "feat(mcp): expose get_taxonomy and get_type_schema over MCP IN"
```

---

## Task 15: End-to-end smoke test

**Files:**
- Create: `src/__tests__/integration/document-standard-e2e.test.ts`

A single integration test that walks the happy path: provision a brain → call `get_taxonomy` over MCP → call `get_type_schema` for canonical → call `search_documents` with the new filters. This catches anything the unit tests missed.

- [ ] **Step 1: Write the test**

Create `src/__tests__/integration/document-standard-e2e.test.ts`. Follow the established integration-test pattern: use `createSeededCompany` + `cleanupCompany` + `createTestToken` from `./helpers`, dispatch via `handleToolCall` with a local `mcpRequest()` helper (modelled after `mvp-mcp-in-read.test.ts`):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleToolCall } from '@/lib/mcp/handler';
import { registerLocusTools } from '@/lib/tools';
import {
  cleanupCompany,
  createSeededCompany,
  createTestToken,
  type TestCompany,
} from './helpers';

let company: TestCompany;
let bearer: string;

beforeAll(async () => {
  company = await createSeededCompany('doc-std-e2e');
  const t = await createTestToken(company.companyId, company.userId);
  bearer = t.token;
  registerLocusTools();
}, 60_000);

afterAll(async () => {
  if (company) await cleanupCompany(company);
}, 60_000);

function mcpRequest(): Request {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

async function callTool(
  toolName: string,
  rawInput: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await handleToolCall({
    toolName,
    rawInput,
    request: mcpRequest(),
  });
  if (response.isError) {
    throw new Error(
      `Tool ${toolName} errored: ${JSON.stringify(response.content)}`,
    );
  }
  return JSON.parse(response.content[0].text);
}

describe('document standard + vocabulary e2e', () => {
  it('returns 7 folders, 7 types, 33 topics from get_taxonomy', async () => {
    const data = await callTool('get_taxonomy', {});
    expect((data.folders as unknown[]).length).toBe(7);
    expect((data.types as unknown[]).length).toBe(7);
    expect((data.topics as unknown[]).length).toBe(33);
    expect((data.synonyms as Record<string, string>)['users']).toBe(
      'customer',
    );
  });

  it('returns canonical schema with owner + last_reviewed_at', async () => {
    const data = await callTool('get_type_schema', { type: 'canonical' });
    expect(
      Object.keys(data.required_fields as Record<string, unknown>).sort(),
    ).toEqual(['last_reviewed_at', 'owner']);
  });

  it('search_documents accepts new filters without erroring', async () => {
    const data = await callTool('search_documents', {
      query: 'anything',
      folder: 'company',
      type: 'canonical',
      topics: ['brand'],
      confidence_min: 'medium',
      max_results: 5,
    });
    // Empty result is fine — what matters is no validation error.
    expect(Array.isArray(data.results)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the smoke test**

```bash
npx vitest run src/__tests__/integration/document-standard-e2e.test.ts
```

Expected: PASS (3 cases).

- [ ] **Step 3: Run the full integration suite**

```bash
npx vitest run src/__tests__/integration/
```

Expected: PASS. Existing integration tests (cross-company-isolation, mvp-mcp-out, mvp-platform-agent, phase-0-e2e, webfetch) should remain green. If `phase-0-e2e.test.ts` asserted on the old 4-folder universal pack, update it to the new 7-folder layout — same pattern as Task 10 step 6.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/integration/document-standard-e2e.test.ts \
        # plus any phase-0-e2e adjustments from step 3
git commit -m "test(integration): document-standard + vocabulary e2e smoke test"
```

---

## Task 16: Final sweep — typecheck, lint, full test run

- [ ] **Step 1: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors. If errors surface, they're real — fix them before claiming done. (Pre-existing errors that pre-date this plan are not in scope; document any you find for follow-up.)

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: clean. Note: `npm run lint` runs both ESLint and the harness-boundary check. If the harness-boundary check complains about anything in `src/lib/agent/`, the change is in the wrong place — move it to the route layer (none of this plan's changes should touch `src/lib/agent/`, so this should be a non-event).

- [ ] **Step 3: Full test run**

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 4: Diff review against the spec**

Walk the spec's `v1 acceptance criteria` sections and verify each item is covered:

**From Document Standard v1:**
- [ ] Every document in the brain conforms to universal + type-specific frontmatter schema → **partial**: validators exist (Task 6); enforcement at write time lands in Phase 3A.
- [ ] MCP write tools enforce type/folder/topic validity at write time → **deferred to Phase 3A**.
- [ ] Maintenance Agent runs three v1 behaviors on every write → **deferred to Phase 2**.
- [ ] Inbox surfaces every flagged Maintenance Agent action → **deferred to Phase 3B**.

**From Topic Vocabulary v1:**
- [x] Every new Tatara workspace is seeded with the 33-term default at provisioning → Tasks 7–9.
- [x] `get_taxonomy` MCP tool returns this list (terms + synonyms map) on first call → Tasks 11, 14.
- [ ] MCP write tools reject proposals with out-of-vocabulary topics, returning a clear `reason` → **deferred to Phase 3A** (the validator is ready and reusable).
- [ ] User can dump email summaries on May 4 via Claude Code MCP and have it pick topics from this vocabulary → **deferred — needs Phase 2 + 3A**.

**Phase 1 acceptance (this plan):**
- [x] Schema migrations applied (Task 1) — including `documents.source` column (created here, populated by Phase 3A write tools, never written in this plan) and the foundational `inbox_items` table (schema only — populated by Phase 2's Maintenance Agent and read by Phase 3B's API)
- [x] TS types for 7 folders + 7 doc types (Tasks 2, 3)
- [x] Universal + per-type Zod schemas (Tasks 4, 5)
- [x] Master frontmatter validator (Task 6)
- [x] Default vocabulary + pure topic validator (Tasks 7, 8)
- [x] Vocabulary seeded on brain provisioning (Task 9)
- [x] Universal Pack rewritten to 7 folders, 0 docs (Task 10)
- [x] `get_taxonomy` + `get_type_schema` MCP tools shipped (Tasks 11, 12, 14)
- [x] `search_documents` filter extensions (Task 13)
- [x] E2E smoke test (Task 15)

- [ ] **Step 5: Commit any final adjustments and tag the milestone**

```bash
git status   # confirm clean tree
git log --oneline -20   # review the milestone's history
```

If everything is committed and clean, this plan is done.

---

## What this plan does NOT cover (for clarity)

| Concern | Plan |
|---|---|
| Maintenance Agent cheap-pass loop | Phase 2 — separate plan from `2026-04-25-tatara-maintenance-agent-v1.md` |
| MCP write tools (`propose_document`, `update_document`, `supersede_document`, `archive_document`, `get_proposal_status`) | Phase 3A — separate plan |
| Inbox API + UI | Phase 3B — separate plan from `2026-04-25-tatara-inbox-v1.md` |
| 30-day expiry cron for inbox_items | Phase 3B |
| Per-workspace vocabulary extension UI | v1.5 — out of scope |
| Industry-specific topic templates | v2+ — out of scope |
| Promotion of `signals → topical folder` | Maintenance Agent v1.5 |

---

## Notes for the implementing engineer

1. **Trust the migration counter.** Migration `0024_document_standard.sql` is the only migration in this plan. If anyone else lands a migration first, renumber yours and re-run the journal check from the pre-flight section.
2. **The `tags` jsonb column on documents stays.** It's legacy and read by other code paths. Don't touch it. The `topics` text[] column is the new typed field; the master validator only reads `topics`.
3. **Don't touch `src/lib/brain/frontmatter.ts`.** It serialises the response-output frontmatter (the small 8-key block returned by `get_document`). It's a different concern from the document-standard schemas. Leaving it alone keeps existing read paths unchanged.
4. **Reserved types pass through.** Existing `agent-scaffolding`, `agent-definition`, and `skill` docs continue to work because the master validator skips per-type validation for them. Don't try to retrofit them onto the new schemas.
5. **Empty Universal Pack is intentional.** The old 10 "fill me in" docs would fail the new validator. If you find yourself adding seed docs back, stop — that's a separate decision.
6. **Tests against live DB.** Most tests in this plan hit the live Supabase via the postgres superuser connection (DATABASE_URL). If your `.env` is missing it, the schema/seed/tool tests will fail to connect. Set it up first.
7. **No source change to `src/__tests__/integration/helpers.ts` is required.** `cleanupCompany` (line 101) and `createTestToken` (line 147) already exist — every new test in this plan uses them as-is.

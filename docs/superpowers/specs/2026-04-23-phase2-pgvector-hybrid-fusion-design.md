# Phase 2 — pgvector + Hybrid Fusion Design

**Date:** 2026-04-23
**Status:** Design complete, pending spec review
**Parent spec:** `docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md` (this is the Phase 2 carve-out of §14.1)
**Phase 1 baseline:** Shipped 2026-04-23 on `feature/agent-memory-phase-1` — see `docs/superpowers/plans/2026-04-22-phase1-retrieval-contract-and-compact-index.md`
**Related:**
- `AGENTS.md` — harness boundary rules (forbidden imports inside `src/lib/memory/`)
- `feedback_plug_and_play_ux.md` — end-user surface hides all retrieval-internal vocabulary

---

## 1. Problem

Phase 1 shipped a tier-gated retrieval core on Postgres tsvector + a compact-index JSONB extracted by rule-based heuristics. It works, but lexical retrieval has known limits:

- Synonyms and paraphrases miss. A query for "discount for big customers" doesn't match a doc that says "enterprise pricing tier."
- Long-tail intent queries (the kind LongMemEval emphasizes) underperform ts_rank because tf-idf rewards exact-term repetition over semantic relevance.
- Multi-token noun phrases break apart in the GIN index.

Phase 1's exit acknowledged this: the smoke-fixture R@5 baseline is meaningful but limited; the Phase 2 entry condition is "wire the seed helper, capture baseline, then prove embedding-based hybrid beats it."

Phase 2 adds whole-document embeddings (OpenAI `text-embedding-3-small`) and fuses cosine similarity with the existing lexical and compact-index scoring. The retrieval API shape is unchanged — `RetrieveQuery` and `RankedResult` types are stable. Only the *quality* of ranking changes.

## 2. Goals

- **Hybrid scoring beats lexical-only.** On at least one benchmark fixture (smoke or LongMemEval), hybrid mode shows higher R@5 than tsvector-only mode. This is the load-bearing exit criterion.
- **Whole-document embeddings, generated durably.** Every document gets an embedding via a Vercel Workflow; failures retry; bulk imports don't block saves.
- **Null-safe fallback.** During backfill (and forever, for any docs whose embedding generation fails), retrieval must work cleanly with `embedding IS NULL`. The cosine term degrades to zero; lexical scoring carries the result.
- **No retrieval API surface change.** `retrieve()` signature, `RetrieveQuery`, `RankedResult` all stable. Hybrid is a scoring upgrade behind the existing seam.
- **Tenancy invariant preserved.** Every vector ANN query is scoped by `(company_id, brain_id)` *before* the cosine ORDER BY. New cross-tenancy test specifically exercises vector search.
- **Cost transparency wired (operator-facing).** Each embedding API call writes a `usage_records` row with both `estimated_cost_usd` and `customer_cost_usd`. Aggregation/UI for tenant visibility deferred to Phase 4.
- **Provider abstraction first concrete impl.** `MemoryProvider.invalidateDocument()` stops being a no-op — re-triggers the embedding workflow. `describe().supports.embeddings` flips to `true`.

## 3. Non-goals

- **No `brain_configs` table.** Per parent spec §6.4, `brain_configs` ships in Phase 3. Phase 2 uses hard-coded default scoring weights in `compose.ts`.
- **No per-brain embedding opt-in.** Every brain in every tenant gets embeddings on every write. Per-brain control is a Phase 3 concern.
- **No semantic chunking.** Whole-document embeddings only. Per parent spec §13, chunking is Phase 2.5 — invoked *only if* whole-doc shows a recall gap on long-form (>10k token) docs.
- **No model A/B testing.** Committed to `text-embedding-3-small`. Swapping later requires one env var + one migration; not worth the abstraction cost now.
- **No tenant-facing UI for embedding state, cost, weights, or model.** Per `feedback_plug_and_play_ux.md`. Operator visibility via `usage_records` rows + Vercel Workflow dashboard only.
- **No KG, no triples, no Maintenance Agent.** All deferred to Phase 3+.
- **No re-embedding on every minor edit.** Workflow triggered on document create + content-change updates; metadata-only updates (title rename, folder move) skip the trigger.

## 4. Constraints

### 4.1 Harness-pure (extends Phase 1)

`src/lib/memory/embedding/` follows the same boundary rules as the rest of `src/lib/memory/`:

- **Allowed:** plain TypeScript, Drizzle/Supabase DB clients, AI SDK (`embed`, `embedMany` from `ai` + `@ai-sdk/openai`), Workflow SDK (`workflow`).
- **Forbidden:** `NextRequest`, `NextResponse`, `cookies()`, `headers()`, `revalidatePath()`, `unstable_cache`, `@vercel/*` request-context APIs, route-handler patterns.

The Workflow trigger function (`triggerEmbeddingFor`) is harness-pure — it imports the workflow SDK's `trigger` API but no Next.js primitives. It's called from the route-handler-level write pipeline, which is the existing seam where tenant context flows in.

`scripts/check-harness-boundary.sh` (extended in Phase 1 to cover `src/lib/memory/`) catches forbidden imports automatically.

### 4.2 Tenant-scoped (extends Phase 1)

Every embedding read filters by `company_id + brain_id` at the predicate level *before* the HNSW ORDER BY. pgvector applies WHERE filters before the ANN scan, so this is both correct and efficient.

`embedding_jobs` is not introduced — Workflows manage their own state. The workflow function loads the document via the tenant-scoped query path (`SELECT FROM documents WHERE id = $documentId AND company_id = $companyId AND brain_id = $brainId`); the tenant tuple is captured at trigger time and passed through workflow args. Defense-in-depth: while document UUIDs are globally unique, every other read path in the codebase scopes by `(company_id, brain_id)` and embeddings should follow the same pattern.

### 4.3 Plug-and-play UX

Per `feedback_plug_and_play_ux.md`: zero new tenant-facing UI in Phase 2. No "embeddings enabled" toggle, no model picker, no weight sliders, no cost dashboard. Operators see the workflow runs in Vercel's observability tab; tenants see *better answers from their agents*.

## 5. Architecture

Three concrete additions on top of Phase 1's memory subsystem.

### 5.1 Module layout

```
src/lib/memory/
├── (Phase 1, unchanged)
│   ├── core.ts                      # SQL gains cosine term
│   ├── compact-index/
│   ├── scoring/
│   │   └── compose.ts               # adds WEIGHT_VEC term
│   ├── overview/
│   ├── providers/tatara-hybrid/
│   │   └── index.ts                 # invalidateDocument re-triggers workflow
│   └── types.ts                     # unchanged shape
└── embedding/                       # NEW (this phase)
    ├── types.ts                     # Embedder interface + dimension constant
    ├── openai.ts                    # OpenAI impl via AI SDK
    ├── workflow.ts                  # embedDocumentWorkflow ('use workflow')
    ├── trigger.ts                   # triggerEmbeddingFor(doc) — write-pipeline hook
    ├── backfill.ts                  # CLI: enumerate NULL embeddings, trigger each
    ├── usage.ts                     # records token usage to usage_records
    └── __tests__/
        ├── openai.test.ts           # mock-embedder unit tests
        ├── workflow.test.ts         # workflow logic tests
        └── trigger.test.ts          # write-pipeline integration test
```

### 5.2 Embedder interface

```typescript
// src/lib/memory/embedding/types.ts
export const EMBEDDING_DIMENSION = 1536;
export const EMBEDDING_MODEL_ID = 'text-embedding-3-small';

export interface EmbedResult {
  vector: number[];                    // length === EMBEDDING_DIMENSION
  promptTokens: number;                // for usage_records
}

export interface Embedder {
  embed(text: string): Promise<EmbedResult>;
  embedMany(texts: string[]): Promise<EmbedResult[]>;
  describe(): { model: string; dimension: number };
}
```

Concrete impl `openai.ts` wraps `embed`/`embedMany` from the AI SDK with the `@ai-sdk/openai` provider. The interface lives so Phase 2.5 (chunking) and Phase 5 (alternative providers) can swap implementations without touching call sites.

### 5.3 Vercel Workflow

```typescript
// src/lib/memory/embedding/workflow.ts
import { openaiEmbedder } from './openai';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { and, eq } from 'drizzle-orm';

export interface EmbedJobArgs {
  documentId: string;
  companyId: string;
  brainId: string;
}

export async function embedDocumentWorkflow(args: EmbedJobArgs) {
  'use workflow';

  const doc = await loadDoc(args);
  if (!doc || doc.deletedAt) return;                    // doc deleted before run
  if (!doc.content || doc.content.trim().length === 0) return;

  const result = await generateEmbedding(doc.content);
  await persistEmbedding(args, result.vector);
  await recordUsage(args, result.promptTokens);
}

async function loadDoc(args: EmbedJobArgs) {
  'use step';
  // Tenant-scoped read — defense-in-depth even though documentId is unique.
  const [row] = await db.select().from(documents).where(
    and(
      eq(documents.id, args.documentId),
      eq(documents.companyId, args.companyId),
      eq(documents.brainId, args.brainId),
    ),
  ).limit(1);
  return row ?? null;
}

async function generateEmbedding(content: string) {
  'use step';
  return openaiEmbedder.embed(content);
}

async function persistEmbedding(args: EmbedJobArgs, vector: number[]) {
  'use step';
  // Tenant-scoped write — same defense-in-depth pattern.
  await db.update(documents).set({ embedding: vector }).where(
    and(
      eq(documents.id, args.documentId),
      eq(documents.companyId, args.companyId),
      eq(documents.brainId, args.brainId),
    ),
  );
}

async function recordUsage(args: EmbedJobArgs, tokens: number) {
  'use step';
  // Writes to usage_records with both estimated_cost_usd and customer_cost_usd
  // (per ADR-003 dual-cost pattern); attribution via args.companyId / args.brainId / args.documentId.
}
```

**Key Workflow properties:**
- Each `'use step'` is independently retried by the Workflow runtime.
- The whole workflow is idempotent: re-running on the same doc produces the same embedding (assuming content unchanged) and overwrites the same row.
- `loadDoc` returning null short-circuits the workflow (doc deleted between trigger and run, OR tuple does not match — same effect).
- Workflow runs are observable in the Vercel dashboard without us building any UI.

### 5.4 Trigger from write pipeline

```typescript
// src/lib/memory/embedding/trigger.ts
import { trigger } from 'workflow';
import { embedDocumentWorkflow, type EmbedJobArgs } from './workflow';

export async function triggerEmbeddingFor(args: EmbedJobArgs): Promise<void> {
  await trigger(embedDocumentWorkflow, { args: [args] });
}
```

Existing route handlers gain one line. POST `/api/brain/documents`:

```typescript
// src/app/api/brain/documents/route.ts (after the INSERT succeeds)
populateCompactIndexForWrite(...);                          // Phase 1 line, existing
await triggerEmbeddingFor({                                 // NEW
  documentId: newDoc.id,
  companyId: newDoc.companyId,
  brainId: newDoc.brainId,
});
await regenerateFolderOverview(...);                        // Phase 1 line, existing
```

PATCH `/api/brain/documents/[id]`:

```typescript
// only re-trigger if content changed; metadata-only updates skip embedding
if (input.content !== undefined && input.content !== existing.content) {
  await triggerEmbeddingFor({
    documentId: existing.id,
    companyId: existing.companyId,
    brainId: existing.brainId,
  });
}
```

The trigger returns immediately; the workflow runs out-of-band. The save response time is unaffected.

### 5.5 Retrieval scoring

`src/lib/memory/core.ts` gains one column in the SELECT and one parameter (the query embedding). The query embedding is generated once per `retrieve()` call before the SQL runs.

```typescript
// inside retrieve()
const queryEmbedding = await openaiEmbedder.embed(q.query);

const rows = await db.execute(sql`
  SELECT
    d.id, d.slug, d.title, d.path, d.content,
    d.updated_at, d.version,
    ts_rank(d.search_vector, plainto_tsquery('english', ${q.query})) AS ts_rank,
    ts_headline(...) AS ts_headline,
    d.compact_index,
    f.slug AS folder_slug,
    CASE WHEN d.embedding IS NOT NULL
         THEN 1 - (d.embedding <=> ${queryEmbedding.vector}::vector)
         ELSE NULL
    END AS cosine_sim
  FROM documents d
  LEFT JOIN folders f ON f.id = d.folder_id
  WHERE d.company_id = ${q.companyId}
    AND d.brain_id = ${q.brainId}
    AND d.deleted_at IS NULL
    AND d.status != 'archived'
    AND d.type IS NULL
    AND (
      d.search_vector @@ plainto_tsquery('english', ${q.query})
      OR d.embedding IS NOT NULL
    )
    ${q.filters?.folderPath ? sql`AND f.slug = ${q.filters.folderPath}` : sql``}
  ORDER BY (
    0.4 * ts_rank(d.search_vector, plainto_tsquery('english', ${q.query}))
    + 0.6 * COALESCE(1 - (d.embedding <=> ${queryEmbedding.vector}::vector), 0)
  ) DESC
  LIMIT ${limit * 3}
`);
```

**WHERE clause expanded.** Phase 1 required `search_vector @@ plainto_tsquery(...)`; Phase 2 OR's with `embedding IS NOT NULL` so docs that are semantically relevant but lack matching keywords surface. Pre-ranks by the same fusion expression to keep the top-K candidates promising.

`composeBoostedScore` in `scoring/compose.ts` extends:

```typescript
export function composeBoostedScore({tsRank, cosineSim, query, content, docUpdatedAt}) {
  const baseScore = WEIGHT_TS * tsRank + WEIGHT_VEC * (cosineSim ?? 0);
  const boosts =
    phraseBoost(query, content) *
    properNounBoost(query, content) *
    temporalProximity(docUpdatedAt);
  return baseScore * boosts;
}

const WEIGHT_TS = 0.4;
const WEIGHT_VEC = 0.6;
```

**Default weights:** `0.4 lexical / 0.6 semantic`. Hand-tuned starting point; semantic-leaning to favor the long-tail-intent queries Phase 2 targets. Tuning is an empirical process driven by benchmark runs (§7.3); per-brain overrides land in Phase 3 with `brain_configs`.

**Query embedding cache.** A per-process LRU (max 100 entries, key=query string) avoids re-embedding identical queries within a request lifecycle. Cleared on process restart; no Redis dependency. **Caveat:** under Vercel Functions' fluid compute, warm-instance lifetime varies — the cache is best-effort, not load-bearing. Hit rate matters most within a single request (e.g. agent calling retrieve() multiple times with the same query); cross-request hits are a bonus, not a guarantee. If query patterns prove repetitive in production, escalate to a Redis-backed cache later.

### 5.6 MemoryProvider provider updates

The `MemoryProvider.invalidateDocument(slug, companyId, brainId)` signature from Phase 1 (`src/lib/memory/types.ts:189-193`) is preserved. Phase 2 implements it instead of leaving it as a no-op:

```typescript
// src/lib/memory/providers/tatara-hybrid/index.ts
async invalidateDocument(
  slug: string,
  companyId: string,
  brainId: string,
): Promise<void> {
  // Resolve slug → documentId via the tenant-scoped read.
  const [row] = await db.select({ id: documents.id })
    .from(documents)
    .where(and(
      eq(documents.slug, slug),
      eq(documents.companyId, companyId),
      eq(documents.brainId, brainId),
    ))
    .limit(1);
  if (!row) return;                                // unknown slug — silent no-op
  await triggerEmbeddingFor({
    documentId: row.id,
    companyId,
    brainId,
  });
}

describe(): ProviderCapabilities {
  return {
    name: 'tatara-hybrid',
    supports: {
      factLookup: false,           // Phase 3
      graphTraverse: false,        // Phase 5
      timeline: false,             // Phase 3
      embeddings: true,            // CHANGED — Phase 2
    },
  };
}
```

`retrieve()` delegation is unchanged — the provider passes through to `core.retrieve()`, which now does hybrid by virtue of its SQL.

## 6. Data model

### 6.1 Migration `0023_documents_embedding.sql`

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents USING hnsw (embedding vector_cosine_ops);
```

**Migration properties:**
- Idempotent (`IF NOT EXISTS` on column + extension + index) — same lesson learned in Phase 1's 0022.
- Applied via Supabase MCP `apply_migration` for project `locus` (id `wvobnayfskzegvrniomq`) so it registers in the migrations registry, not just drizzle-kit push.
- HNSW defaults (`m=16`, `ef_construction=64`) — pgvector's defaults work fine for corpora up to ~1M vectors. Tuning is a Phase 5 concern if recall on large brains shows a gap.
- Rollback: `DROP INDEX documents_embedding_hnsw_idx; ALTER TABLE documents DROP COLUMN embedding;` — fully reversible.

### 6.2 Drizzle schema

`src/db/schema/documents.ts` gains:

```typescript
import { customType } from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[] | null; driverData: string | null }>({
  dataType() { return `vector(${EMBEDDING_DIMENSION})`; },
  toDriver(value: number[] | null): string | null {
    return value === null ? null : `[${value.join(',')}]`;
  },
  fromDriver(value: string | null): number[] | null {
    if (value === null || value === undefined) return null;
    return value.replace(/^\[|\]$/g, '').split(',').map(Number);
  },
});

// inside documents table definition:
embedding: vector('embedding'),

// inside indexes section:
embeddingHnswIdx: index('documents_embedding_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
```

**Null-handling is load-bearing** here — during backfill (and forever, for any doc whose workflow failed), the column will be NULL. Drizzle reads must return `null` cleanly without throwing on `value.replace(...)`.

Same custom-type pattern as Phase 1's `tsvector` column. Drizzle's HNSW index helper has been stable since drizzle-orm 0.32+.

### 6.3 No new tables

- **No `embedding_jobs` table.** Workflows manage their own state. If we ever outgrow Workflows (cost or feature), we can introduce a queue table behind the same `triggerEmbeddingFor` interface — call sites don't change.
- **No `brain_configs`.** Phase 3.

## 7. Backfill

165 live documents currently have `embedding IS NULL`. Backfill mirrors Phase 1's `scripts/backfill-compact-index-phase1.ts` pattern but triggers the workflow per doc rather than computing inline:

```typescript
// scripts/backfill-embeddings-phase2.ts
import 'dotenv/config';
import { isNull } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { triggerEmbeddingFor } from '@/lib/memory/embedding/trigger';

async function main() {
  const rows = await db.select({
    id: documents.id,
    companyId: documents.companyId,
    brainId: documents.brainId,
  })
    .from(documents)
    .where(isNull(documents.embedding));

  for (const row of rows) {
    await triggerEmbeddingFor({
      documentId: row.id,
      companyId: row.companyId,
      brainId: row.brainId,
    });
    console.log(`[backfill] triggered embedding for ${row.id}`);
  }
  console.log(`[backfill] enqueued ${rows.length} workflow runs`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
```

**Why per-doc trigger rather than inline `embedMany`:**
- Backfill failures recover automatically via Workflow retries.
- Same code path as live writes — fewer divergent code paths to maintain.
- For 165 docs the difference is negligible (~165 workflow events vs ~2 batched `embedMany` calls). For 100k+ enterprise corpora, batching inside the workflow itself (fan-out steps) is a future optimization.

Backfill is idempotent: re-running enqueues new workflow runs that overwrite the same embedding column. Safe to invoke multiple times.

## 8. Testing

### 8.1 Unit tests (no DB)

- `embedding/openai.test.ts` — Embedder impl with a mock `embed` function. Covers single + batch.
- `scoring/compose.test.ts` — extended to verify `WEIGHT_VEC * cosineSim` is added; `cosineSim === null` falls through cleanly.
- `embedding/trigger.test.ts` — verifies the trigger function calls `workflow.trigger` with the right args (mock the SDK).

### 8.2 Integration tests (DB, harness-pure)

- `memory/__tests__/core-hybrid.test.ts` — extends Phase 1's `core.test.ts`. Seeds two docs (one with embedding matching query, one without). Verifies hybrid mode ranks the embedded doc higher; verifies null-embedding docs still surface via lexical path.
- `memory/__tests__/cross-tenancy.test.ts` — extended (Phase 1's existing file) with one new case: two brains, one query embedding, vector ANN must not return the other brain's doc even if cosine sim is high.
- `embedding/__tests__/workflow.test.ts` — invokes `embedDocumentWorkflow` directly (bypassing `trigger`) with mock Embedder. Verifies the row is updated; verifies deleted-doc short-circuit; verifies usage record is written.

### 8.3 Benchmark (manual + CI)

`tests/benchmarks/runner.ts` — Phase 1 scaffold completed:

1. **Wire seed step** (Phase 2 Task 0). Pull the test fixture's `seedBrainInCompany` helper into a CLI-callable variant. The Phase 1 runner has a `throw` here; this is the first thing Phase 2 fixes.
2. **Capture Phase 1 baseline.** Run the runner against `tests/benchmarks/fixtures/sample.json` *before* any Phase 2 SQL changes. Record R@5/R@10/MRR. This is the "beat this" target.
3. **Smoke fixture (in-repo).** ~30 hand-crafted Q&A in `tests/benchmarks/fixtures/sample.json`. Both lexical-only mode (force `WEIGHT_VEC=0`) and hybrid mode are run; metrics reported side-by-side.
4. **LongMemEval integration.** `tests/benchmarks/fixtures/longmemeval.json` downloaded from HuggingFace (~500 multi-turn questions). Loader script in `tests/benchmarks/load-longmemeval.ts`. Run once per phase; metrics archived in `tests/benchmarks/results/`.
5. **CI smoke check.** `npm run benchmark:smoke` runs the smoke fixture in hybrid mode and exits non-zero if R@5 drops by more than 5% vs the baseline captured in step 2.

   Two distinct gates to keep clear when reading later:
   - **Floor gate (CI, this step):** `hybrid_R@5 >= phase1_baseline_R@5 - 0.05`. Catches regressions during ongoing development. Lexical-only baseline is the floor because hybrid should *never* be worse than what Phase 1 shipped.
   - **Target gate (exit criterion §12):** `hybrid_R@5 > lexical_only_R@5` on at least one fixture, where both are measured *with Phase 2 SQL* (the only difference is `WEIGHT_VEC=0` vs `WEIGHT_VEC=0.6`). This is what "hybrid beats lexical-only" means and is the load-bearing reason to ship Phase 2.

   Wire only the floor gate into pre-merge CI. The target gate is a one-shot human-readable comparison done before declaring Phase 2 done.

### 8.4 Workflow chaos test

Manually verify (not in CI):
- Trigger workflow for a doc, kill the underlying step (mock OpenAI 503). Verify Workflow retries → eventually succeeds → embedding lands.
- Trigger workflow for a doc that gets deleted between trigger and step-1. Verify graceful no-op, no error.
- Trigger 500 backfill workflows simultaneously. Verify Workflow runtime serializes/parallelizes appropriately, no thundering-herd OpenAI rate-limit failures.

**One promoted to CI smoke (lower N):** trigger 5 workflows simultaneously against the test corpus and verify all 5 embeddings land within a reasonable time bound. Cheap, exercises the trigger→workflow→DB roundtrip end-to-end, catches regressions in workflow registration without the cost of a full chaos run.

## 9. Cost & observability

### 9.1 Cost model

OpenAI `text-embedding-3-small` pricing (as of 2026-04): $0.02 per 1M tokens.

Estimated Phase 2 spend:
- Backfill of 165 docs at ~2k tokens/doc avg ≈ 330k tokens ≈ **$0.0066** (one-shot).
- Steady state: assume 10 doc-writes/day per active brain × 100 active brains × 2k tokens ≈ 2M tokens/day ≈ **$0.04/day**.
- Query-time embeddings (one per `retrieve()` call) — assume 1k retrieve/day per brain × 100 brains × 50 tokens/query ≈ 5M tokens/day ≈ **$0.10/day**.

Total expected Phase 2 OpenAI bill at MVP scale: **<$5/month**. Material at enterprise scale; trivial at pilot scale.

### 9.2 Usage records

Every embedding API call writes a `usage_records` row:
- `kind: 'embedding'`
- `model: 'text-embedding-3-small'`
- `tokens_used: <prompt_tokens>`
- `estimated_cost_usd: tokens × 0.02 / 1_000_000`
- `customer_cost_usd: <opaque markup per ADR-003>`
- `company_id`, `brain_id`, `document_id` for attribution

This makes Phase 2 cost ready for Phase 4's tenant-facing cost surface without any retroactive backfill.

### 9.3 Operator observability

- Vercel Workflow dashboard shows every embedding workflow run, success/failure, latency, retry counts. Free with Workflows.
- `usage_records` aggregations per company/brain are queryable via existing admin endpoints.
- No new dashboards built in Phase 2.

## 10. Plug-and-play UX (non-negotiable)

Per `feedback_plug_and_play_ux.md`, **zero new tenant-facing UI** in Phase 2:

- No "embeddings enabled" indicator in the brain UI.
- No model picker.
- No weight tuning controls.
- No embedding cost dashboard for tenants.
- No "your doc was embedded" notification.

Tenant-visible behavior change: their agents return better answers on semantic-intent queries. That's the only signal. The mechanism stays invisible.

If an end user *asks* an agent "how do you find docs?" the agent's system prompt should answer in product language ("I search across your brain's documents using your query"), never in infrastructure language ("I run a hybrid lexical + cosine-similarity ranking with HNSW...").

## 11. Migration sequence & rollback

```
Phase 1 (shipped):
  0022  documents.compact_index + 3 GIN indexes

Phase 2 (this spec):
  0023  CREATE EXTENSION vector + documents.embedding vector(1536) + HNSW index
```

**Rollback Phase 2:**
1. Set `WEIGHT_VEC = 0` in `compose.ts` (immediately disables semantic ranking; lexical-only mode resumes — equivalent to Phase 1 behavior).
2. Stop triggering the workflow on writes (comment out the `triggerEmbeddingFor` calls). **Caveat:** new docs written after this step will have `embedding IS NULL`. Combined with step 1 (`WEIGHT_VEC=0`), this is benign — semantic scoring is off anyway. If step 1 is skipped and only step 2 is taken, freshly-written docs lose semantic scoring while older docs retain it; avoid that combination.
3. (Optional, only if abandoning embeddings entirely) `DROP INDEX documents_embedding_hnsw_idx; ALTER TABLE documents DROP COLUMN embedding;`.

Step 1 is the immediate rollback if hybrid produces worse results than lexical. Step 3 is only if we're abandoning embeddings entirely (unlikely).

## 12. Exit criteria

Phase 2 ships when **all** of:

- [ ] Migration `0023` applied via Supabase MCP, registered in migrations registry.
- [ ] All live documents have `embedding IS NOT NULL` (backfill complete; verified via SQL count).
- [ ] `tatara-hybrid` provider's `describe().supports.embeddings === true`.
- [ ] All Phase 1 retrieval tests still pass; new hybrid + cross-tenancy ANN tests pass.
- [ ] Benchmark runner's seed step works end-to-end (no `throw`).
- [ ] Phase 1 baseline R@5 captured on smoke fixture and recorded in `tests/benchmarks/results/baseline.json`.
- [ ] Hybrid mode beats tsvector-only mode on at least one fixture (smoke or LongMemEval) on R@5.
- [ ] LongMemEval fixture loaded; baseline + hybrid results archived.
- [ ] `usage_records` has `kind='embedding'` rows for every embedding API call.
- [ ] Vercel Workflow visible in the project dashboard with non-zero runs.
- [ ] Harness-boundary check passes (no Next.js / Vercel-platform imports inside `src/lib/memory/embedding/`).

**Reversibility check:** flipping `WEIGHT_VEC = 0` in `compose.ts` must restore Phase 1 behavior exactly (verify via re-running smoke fixture). This is the safety valve.

## 13. Deferred to Phase 3+

These items came up while scoping Phase 2 but explicitly do *not* land here:

- **Per-brain weight overrides** — needs `brain_configs` (Phase 3).
- **Per-brain embedding opt-out** — needs `brain_configs` (Phase 3); not a Phase 2 concern.
- **Tenant-facing cost UI** — Phase 4 with the unified Maintenance dashboard.
- **Semantic chunking** — Phase 2.5 conditional, only if whole-doc shows a recall gap on long-form docs (>10k tokens).
- **Embedding model A/B** — committed to text-embedding-3-small; revisit only if benchmarks show a meaningful gap.
- **HNSW tuning** — defaults work to ~1M vectors. Phase 5 if large brains show recall regressions.
- **Query embedding cache backed by Redis** — in-process LRU is fine for MVP; escalate if production traffic patterns warrant.
- **Fan-out batching inside workflows for bulk imports** — current per-doc trigger is fine for ≤10k docs; fan-out is a Phase 3+ optimization if enterprise import sizes grow.
- **RAGAS integration** — parent spec §14.1 task 15 lists RAGAS (faithfulness / answer-relevance / context-precision via LLM-judge) as a Phase 2 task. Deferring to Phase 4 because: (a) RAGAS measures *generation* quality, not *retrieval* quality; Phase 2 is purely a retrieval upgrade with no generation component; (b) LLM-judge calls add ongoing cost that's better introduced alongside the Maintenance Agent's own LLM cost budget in Phase 4; (c) LongMemEval gives us retrieval R@K + MRR which is the right exit-criterion shape for this phase. Revisit when generation-quality gates first appear in Phase 4+.

## 14. References

- Parent architecture spec: `docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md` (§14.1 is this phase's task skeleton)
- Phase 1 plan: `docs/superpowers/plans/2026-04-22-phase1-retrieval-contract-and-compact-index.md`
- AI SDK embeddings: https://sdk.vercel.ai/docs/ai-sdk-core/embeddings
- Vercel Workflows: https://vercel.com/docs/workflows
- pgvector HNSW docs: https://github.com/pgvector/pgvector
- LongMemEval dataset: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
- Plug-and-play UX principle: `~/.claude/projects/.../memory/feedback_plug_and_play_ux.md`

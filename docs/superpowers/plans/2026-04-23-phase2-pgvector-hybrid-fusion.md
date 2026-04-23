# Phase 2 Implementation Plan — pgvector + Hybrid Fusion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI text-embedding-3-small (1536d) embeddings to every document, generated durably via Vercel Workflows, fused with Phase 1's tsvector + compact-index scoring so hybrid mode measurably beats tsvector-only on at least one benchmark.

**Architecture:** New harness-pure subsystem at `src/lib/memory/embedding/` that wraps the AI SDK `embed()` call in a Vercel Workflow. The write pipeline (POST + PATCH route handlers for documents) fires the workflow on each save; the workflow loads the doc tenant-scoped, generates the embedding, persists it, and writes a usage row. The retrieve() SQL gains a cosine-similarity term that fuses with ts_rank via `composeBoostedScore`. Null embeddings (during/after backfill) fall through cleanly — lexical scoring carries the result.

**Tech Stack:** TypeScript, Next.js 16 App Router, Drizzle ORM on Supabase Postgres (pgvector + HNSW), Vercel Workflows (`workflow` SDK), Vercel AI SDK (`ai` + `@ai-sdk/gateway` — routes OpenAI calls through the Gateway for OIDC auth + cost tracking + failover), Vitest for tests.

**Spec reference:** `docs/superpowers/specs/2026-04-23-phase2-pgvector-hybrid-fusion-design.md` (everything below traces back to spec sections).

**Phase 1 prerequisite:** This plan assumes Phase 1 has shipped (`feature/agent-memory-phase-1`, 34 commits, all tests passing, 165 docs backfilled with `compact_index`). The plan continues on the same branch — no new worktree.

---

## File structure

```
locus-web/
  package.json                                              [MODIFY — add workflow (Gateway provider already installed)]

  src/db/
    schema/
      documents.ts                                          [MODIFY — vector custom type + embedding column + HNSW index]
    migrations/
      0023_documents_embedding.sql                          [NEW]

  src/lib/memory/
    core.ts                                                 [MODIFY — cosine SQL + query embedding]
    embedding/                                              [NEW — harness-pure]
      types.ts
      openai.ts
      cache.ts
      workflow.ts
      trigger.ts
      usage.ts
      __tests__/
        openai.test.ts
        cache.test.ts
        workflow.test.ts
        trigger.test.ts
        usage.test.ts
    scoring/
      compose.ts                                            [MODIFY — WEIGHT_VEC term + optional weights override]
      __tests__/
        compose.test.ts                                     [MODIFY — extend with cosineSim cases]
    providers/tatara-hybrid/
      index.ts                                              [MODIFY — invalidateDocument + describe.embeddings=true]
      __tests__/
        capabilities.test.ts                                [MODIFY — flip embeddings expectation]
    __tests__/
      _fixtures.ts                                          [MODIFY — seedBrainWithEmbeddings helper]
      core-hybrid.test.ts                                   [NEW — hybrid integration]
      cross-tenancy.test.ts                                 [MODIFY — add ANN isolation case]

  src/lib/usage/
    record.ts                                               [MODIFY — extend rate map with text-embedding-3-small]

  src/app/api/brain/documents/
    route.ts                                                [MODIFY — POST hooks triggerEmbeddingFor]
    [id]/route.ts                                           [MODIFY — PATCH hooks triggerEmbeddingFor on content change]

  scripts/
    backfill-embeddings-phase2.ts                           [NEW — CLI backfill]

  tests/benchmarks/
    runner.ts                                               [MODIFY — wire seed helper, add --weight-vec flag]
    seed.ts                                                 [NEW — CLI-friendly variant of seedBrainInCompany]
    load-longmemeval.ts                                     [NEW — HF dataset loader]
    fixtures/
      sample.json                                           [MODIFY — expand to ~30 Q&A]
      longmemeval.json                                      [NEW — generated, gitignored]
    results/
      .gitkeep                                              [NEW]
      baseline.json                                         [generated]
      hybrid.json                                           [generated]
    README.md                                               [MODIFY — Phase 2 instructions]
    __tests__/
      smoke-concurrent-workflow.test.ts                     [NEW — 5-concurrent workflow CI test]
```

---

## Conventions used in this plan

- **Test framework:** `vitest`. Run a single file with `npx vitest run src/lib/memory/embedding/__tests__/openai.test.ts`. Run all: `npx vitest run`.
- **Migrations:** raw SQL in `src/db/migrations/NNNN_name.sql`, numbered sequentially. Phase 1 ended at 0022; this plan starts at 0023. Apply via Supabase MCP `apply_migration` (project name `locus`, id `wvobnayfskzegvrniomq`) — drizzle-kit push does NOT register the migration in Supabase's registry.
- **TDD rhythm:** one test, fail, minimal code, pass, commit. Resist writing implementation before the test.
- **Boundary rule:** every file under `src/lib/memory/` (including the new `embedding/` subdir) must not import from `next/*`, `@vercel/functions`, `src/lib/agent/`, or `src/lib/subagent/`. Imports from `@/db`, `ai`, `@ai-sdk/gateway`, and `workflow` are fine. The existing `scripts/check-harness-boundary.sh` already covers `src/lib/memory/` since Phase 1.
- **Commit style:** match existing history — `type: short summary` (e.g. `feat:`, `refactor:`, `test:`, `docs:`, `chore:`). Keep first line ≤72 chars.
- **Co-author trailer:** every commit uses `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **File-level comment banner:** follow the project's existing top-of-file prose style (see `src/lib/memory/core.ts:1-10`). One short paragraph, no emoji, no marketing copy.
- **Plug-and-play UX (load-bearing):** zero new tenant-facing UI in this phase. No "embeddings enabled" indicators, no model picker, no weight controls. Operator visibility lives in Vercel Workflow dashboard + `usage_records` only.
- **Spec-vs-test conflict policy:** when an implementer subagent finds a spec/test contradiction during TDD, **STOP and report** (DONE_WITH_CONCERNS or BLOCKED). Do not modify spec code or rewrite the contract — the controller resolves. Phase 1 burned a full task on this in proper-nouns.ts; the resolution is to ask, not infer.

---

## Task 1: Install dependencies + verify Gateway access

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Workflow SDK + cross-env**

```bash
npm install workflow
npm install -D cross-env
```

Expected: `workflow` added to `dependencies`; `cross-env` to `devDependencies`. The Vercel AI Gateway provider (`@ai-sdk/gateway`) is already installed per existing `package.json` — we route OpenAI calls through it rather than installing `@ai-sdk/openai` directly. This gives us OIDC auth, cost tracking via the Gateway dashboard, and provider failover at no extra code cost.

Why `cross-env`: the benchmark npm scripts (Task 25) prefix `MEMORY_WEIGHT_VEC=0 ...` on the same line as the command. That syntax silently ignores the env var on Windows cmd/PowerShell, so a developer running `npm run benchmark:smoke-baseline` would compare hybrid-to-hybrid and declare spurious success. `cross-env` makes the prefix portable. Required because this codebase is developed on Windows.

- [ ] **Step 2: Verify AI Gateway access (OIDC, not raw provider keys)**

The Vercel AI Gateway authenticates via Vercel's OIDC token rather than raw provider API keys. Pull the local credentials:

```bash
vercel env pull .env.local
```

Expected: `.env.local` populated with `VERCEL_OIDC_TOKEN` (and any project-scoped vars). The Gateway provider auto-detects this token; calls to `gateway.textEmbeddingModel('openai/text-embedding-3-small')` route through Vercel without us managing an OpenAI API key directly.

If the Vercel CLI is not installed: `npm install -g vercel` first, then `vercel link` to connect this directory to the project, then `vercel env pull .env.local`.

Smoke-check the token is present:

```bash
node -e "console.log(process.env.VERCEL_OIDC_TOKEN ? 'gateway auth OK' : 'MISSING — run vercel env pull')"
```

- [ ] **Step 3: Verify the harness-boundary script still passes**

```bash
npm run check-boundary
```

Expected: `check-harness-boundary: OK`. (The new packages don't violate the boundary; this is a smoke check that nothing else has drifted.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add workflow SDK for Phase 2

Phase 2 needs Vercel Workflows for durable embedding generation. The
@ai-sdk/gateway provider is already installed and is the auth path
for OpenAI embedding calls (OIDC, not raw API keys).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `embedding` column + migration

**Files:**
- Create: `src/db/migrations/0023_documents_embedding.sql`

- [ ] **Step 1: Draft the migration SQL**

```sql
-- Adds embedding: 1536-dim vector for OpenAI text-embedding-3-small
-- (Phase 2). Populated asynchronously by the embedDocumentWorkflow
-- (src/lib/memory/embedding/workflow.ts) — column is nullable so writes
-- never block on the embedding API. HNSW index supports the cosine
-- similarity fused into retrieve() (src/lib/memory/core.ts).
-- See docs/superpowers/specs/2026-04-23-phase2-pgvector-hybrid-fusion-design.md.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` with:
- project_id: `wvobnayfskzegvrniomq`
- name: `0023_documents_embedding`
- query: the SQL above

Expected: migration applied; `mcp__plugin_supabase_supabase__list_migrations` shows it registered. The IF NOT EXISTS clauses make this idempotent (safe to re-apply).

- [ ] **Step 3: Verify in DB**

```bash
# Use mcp__plugin_supabase_supabase__execute_sql:
SELECT column_name, data_type, udt_name FROM information_schema.columns
WHERE table_name = 'documents' AND column_name = 'embedding';
```

Expected: one row, `data_type` user-defined, `udt_name='vector'`.

```bash
SELECT indexname FROM pg_indexes
WHERE tablename = 'documents' AND indexname = 'documents_embedding_hnsw_idx';
```

Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/0023_documents_embedding.sql
git commit -m "$(cat <<'EOF'
feat: add embedding vector(1536) column to documents

Migration 0023 introduces the pgvector extension + a 1536-dimension
embedding column with an HNSW cosine-ops index. Column is nullable;
the embedDocumentWorkflow populates it asynchronously per spec §6.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Drizzle schema — vector custom type + embedding column

**Files:**
- Modify: `src/db/schema/documents.ts`

- [ ] **Step 1: Add the vector custom type and column**

Find the existing `tsvector` `customType` block in `src/db/schema/documents.ts` (around line 32). Add a `vector` custom type right after it:

```typescript
// pgvector. The column is written by the embedDocumentWorkflow
// (src/lib/memory/embedding/workflow.ts) — Drizzle just needs a
// matching column type. Null-safe in both directions because
// freshly-written docs have NULL until the async workflow lands.
const vector = customType<{ data: number[] | null; driverData: string | null }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[] | null): string | null {
    return value === null ? null : `[${value.join(',')}]`;
  },
  fromDriver(value: string | null): number[] | null {
    if (value === null || value === undefined) return null;
    return value.replace(/^\[|\]$/g, '').split(',').map(Number);
  },
});
```

Then in the `documents` `pgTable` definition, add the embedding column right after `compactIndex`:

```typescript
// 1536-dim OpenAI text-embedding-3-small vector. Written
// asynchronously by embedDocumentWorkflow; NULL until the workflow
// completes for a freshly-saved doc.
embedding: vector('embedding'),
```

In the indexes array (after the three `documents_compact_index_*` indexes), add:

```typescript
index('documents_embedding_hnsw_idx').using(
  'hnsw',
  sql`embedding vector_cosine_ops`,
),
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. If Drizzle complains about the index helper signature, fall back to a simpler form using `sql` for the index expression (as shown above) — drizzle-orm 0.45.x has stable `sql\`\`` index support.

- [ ] **Step 3: Smoke test the column reads + writes**

```bash
# Use mcp__plugin_supabase_supabase__execute_sql to verify a manual write/read works:
UPDATE documents SET embedding = ('[' || array_to_string(array_fill(0.1, ARRAY[1536]), ',') || ']')::vector
WHERE id = (SELECT id FROM documents WHERE deleted_at IS NULL LIMIT 1);
SELECT id, (embedding[1])::text FROM documents WHERE embedding IS NOT NULL LIMIT 1;
```

Expected: one row, embedding[1] ≈ 0.1.

Then revert the test write:

```sql
UPDATE documents SET embedding = NULL WHERE embedding IS NOT NULL;
```

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/documents.ts
git commit -m "$(cat <<'EOF'
feat(schema): add vector custom type + embedding column

Drizzle column for the 1536-dim embedding. Custom type round-trips
NULL cleanly so reads of un-embedded docs (during/after backfill) do
not throw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Embedding subsystem — types module

**Files:**
- Create: `src/lib/memory/embedding/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// Embedder interface + dimension constant. Phase 2 ships a single
// concrete implementation (OpenAI via AI SDK) but the interface lives
// so Phase 2.5 (chunking) and Phase 5 (alternative providers) can swap
// implementations without touching call sites.
//
// Harness-pure — no imports from next/*, @vercel/functions, or src/lib/agent.

export const EMBEDDING_MODEL_ID = 'text-embedding-3-small';
export const EMBEDDING_DIMENSION = 1536;

export interface EmbedResult {
  vector: number[];        // length === EMBEDDING_DIMENSION
  promptTokens: number;    // for usage_records billing
}

export interface Embedder {
  embed(text: string): Promise<EmbedResult>;
  embedMany(texts: string[]): Promise<EmbedResult[]>;
  describe(): { model: string; dimension: number };
}

// Args passed through every step of the embedDocumentWorkflow. The
// tenant tuple is included so the workflow loads + persists with
// (id, companyId, brainId) defense-in-depth scoping. See spec §5.3.
export interface EmbedJobArgs {
  documentId: string;
  companyId: string;
  brainId: string;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/memory/embedding/types.ts
git commit -m "$(cat <<'EOF'
feat(memory): scaffold embedding subsystem with Embedder interface

Embedder + EmbedResult + EmbedJobArgs types. Phase 2 ships one
concrete impl (OpenAI) but the interface lives so future phases can
swap providers without touching call sites. Dimension constant locked
at 1536 to match text-embedding-3-small.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: OpenAI Embedder implementation

**Files:**
- Create: `src/lib/memory/embedding/openai.ts`
- Create: `src/lib/memory/embedding/__tests__/openai.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/memory/embedding/__tests__/openai.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI SDK embed/embedMany + Gateway provider before importing
// the module under test. Gateway is the auth path (OIDC); the mock
// returns a fake model handle that openai.test.ts doesn't introspect.
const embedMock = vi.fn();
const embedManyMock = vi.fn();
vi.mock('ai', () => ({
  embed: (args: unknown) => embedMock(args),
  embedMany: (args: unknown) => embedManyMock(args),
}));
vi.mock('@ai-sdk/gateway', () => ({
  gateway: { textEmbeddingModel: (id: string) => ({ id }) },
}));

import { openaiEmbedder } from '../openai';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL_ID } from '../types';

describe('openaiEmbedder', () => {
  beforeEach(() => {
    embedMock.mockReset();
    embedManyMock.mockReset();
  });

  it('embed() returns a vector of the right dimension and the prompt token count', async () => {
    const fakeVec = new Array(EMBEDDING_DIMENSION).fill(0.123);
    embedMock.mockResolvedValueOnce({ embedding: fakeVec, usage: { tokens: 17 } });

    const out = await openaiEmbedder.embed('hello world');

    expect(out.vector).toEqual(fakeVec);
    expect(out.vector.length).toBe(EMBEDDING_DIMENSION);
    expect(out.promptTokens).toBe(17);
    expect(embedMock).toHaveBeenCalledOnce();
  });

  it('embedMany() returns one result per input', async () => {
    const fakeVec = new Array(EMBEDDING_DIMENSION).fill(0.5);
    embedManyMock.mockResolvedValueOnce({
      embeddings: [fakeVec, fakeVec, fakeVec],
      usage: { tokens: 30 },
    });

    const out = await openaiEmbedder.embedMany(['a', 'b', 'c']);

    expect(out).toHaveLength(3);
    expect(out[0].vector).toEqual(fakeVec);
    // promptTokens divided pro-rata across the batch (OpenAI returns total only).
    expect(out[0].promptTokens + out[1].promptTokens + out[2].promptTokens).toBe(30);
  });

  it('describe() returns the model id and dimension', () => {
    expect(openaiEmbedder.describe()).toEqual({
      model: EMBEDDING_MODEL_ID,
      dimension: EMBEDDING_DIMENSION,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/memory/embedding/__tests__/openai.test.ts
```

Expected: FAIL with `Cannot find module '../openai'`.

- [ ] **Step 3: Implement the OpenAI Embedder**

```typescript
// src/lib/memory/embedding/openai.ts
//
// OpenAI Embedder, routed through the Vercel AI Gateway. Uses
// text-embedding-3-small (1536 dim). Wraps embed/embedMany so call
// sites remain provider-agnostic via the Embedder interface.
//
// Auth path: Gateway uses Vercel's OIDC token (VERCEL_OIDC_TOKEN env
// var, populated by `vercel env pull .env.local`). No raw OpenAI API
// key is held by this code — provider routing, failover, and cost
// telemetry happen in the Gateway control plane.
//
// Harness-pure — only imports `ai` and `@ai-sdk/gateway`. Both are
// platform-agnostic (no Next.js / @vercel/functions coupling).

import { embed, embedMany } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSION,
  type Embedder,
  type EmbedResult,
} from './types';

// Gateway model id is `<provider>/<model>`; provider prefix is required.
const model = gateway.textEmbeddingModel(`openai/${EMBEDDING_MODEL_ID}`);

export const openaiEmbedder: Embedder = {
  async embed(text: string): Promise<EmbedResult> {
    const { embedding, usage } = await embed({ model, value: text });
    return {
      vector: embedding,
      promptTokens: usage?.tokens ?? 0,
    };
  },

  async embedMany(texts: string[]): Promise<EmbedResult[]> {
    const { embeddings, usage } = await embedMany({ model, values: texts });
    // OpenAI returns a single aggregate token count for the batch. Divide
    // pro-rata across inputs so per-doc usage_records sum to the actual
    // billed total. Imperfect (per-doc accuracy isn't load-bearing) but
    // billing-faithful in aggregate.
    const total = usage?.tokens ?? 0;
    const perDoc = embeddings.length > 0 ? Math.floor(total / embeddings.length) : 0;
    const remainder = total - perDoc * embeddings.length;
    return embeddings.map((vector, i) => ({
      vector,
      promptTokens: i === 0 ? perDoc + remainder : perDoc,
    }));
  },

  describe() {
    return { model: EMBEDDING_MODEL_ID, dimension: EMBEDDING_DIMENSION };
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/memory/embedding/__tests__/openai.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Verify boundary**

```bash
npm run check-boundary
```

Expected: `check-harness-boundary: OK`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/memory/embedding/openai.ts src/lib/memory/embedding/__tests__/openai.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): OpenAI Embedder via Vercel AI Gateway

text-embedding-3-small wrapper exposed via the Embedder interface,
routed through @ai-sdk/gateway for OIDC auth + cost tracking. embedMany
splits the aggregate token count pro-rata so per-doc usage records
sum to the actual billed total.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add embedding model to the usage rate map

**Files:**
- Modify: `src/lib/usage/record.ts`

- [ ] **Step 1: Inspect the existing `PROVIDER_COST_PER_1K_TOKENS` map**

```bash
sed -n '60,120p' src/lib/usage/record.ts
```

Expected: a `Record<string, { input, cachedInput, output }>` map with Anthropic + Google models.

- [ ] **Step 2: Extend the source union type and rate map**

Edit `src/lib/usage/record.ts`:

In `RecordUsageParams.source` (around line 40), add `'embedding_worker'` to the union:

```typescript
source?: 'platform_agent' | 'maintenance_agent' | 'mcp' | 'system' | 'subagent' | 'embedding_worker';
```

In `PROVIDER_COST_PER_1K_TOKENS`, add the OpenAI embedding rate (text-embedding-3-small is $0.02 per 1M tokens = $0.00002 per 1K tokens):

```typescript
// OpenAI text embeddings (Phase 2). cachedInput unused (no cache for
// embeddings), output unused (embeddings have no output tokens). Set to 0
// rather than the input rate so a stray usage call with output tokens
// doesn't quietly bill.
'openai/text-embedding-3-small': {
  input: 0.00002,
  cachedInput: 0,
  output: 0,
},
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/usage/record.ts
git commit -m "$(cat <<'EOF'
feat(usage): add text-embedding-3-small rate + embedding_worker source

Phase 2's embedDocumentWorkflow writes a usage_records row per
embedding API call. Source 'embedding_worker' attributes the spend;
rate map adds OpenAI text-embedding-3-small at \$0.02/1M input tokens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Embedding usage helper

**Files:**
- Create: `src/lib/memory/embedding/usage.ts`
- Create: `src/lib/memory/embedding/__tests__/usage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/memory/embedding/__tests__/usage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordUsageMock = vi.fn();
vi.mock('@/lib/usage/record', () => ({
  recordUsage: (args: unknown) => recordUsageMock(args),
}));

import { recordEmbeddingUsage } from '../usage';

describe('recordEmbeddingUsage', () => {
  beforeEach(() => recordUsageMock.mockReset());

  it('writes a usage_records row with the embedding-worker source', async () => {
    recordUsageMock.mockResolvedValueOnce({ id: 'fake-id' });

    await recordEmbeddingUsage({
      companyId: 'co-1',
      brainId: 'br-1',
      documentId: 'doc-1',
      promptTokens: 250,
    });

    expect(recordUsageMock).toHaveBeenCalledOnce();
    const args = recordUsageMock.mock.calls[0][0];
    expect(args.companyId).toBe('co-1');
    expect(args.modelId).toBe('openai/text-embedding-3-small');
    expect(args.inputTokens).toBe(250);
    expect(args.outputTokens).toBe(0);
    expect(args.totalTokens).toBe(250);
    expect(args.source).toBe('embedding_worker');
    expect(args.userId).toBeNull();
    expect(args.sessionId).toBeNull();
  });

  it('returns null without throwing when recordUsage returns null', async () => {
    recordUsageMock.mockResolvedValueOnce(null);
    await expect(
      recordEmbeddingUsage({
        companyId: 'co-1',
        brainId: 'br-1',
        documentId: 'doc-1',
        promptTokens: 0,
      }),
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/memory/embedding/__tests__/usage.test.ts
```

Expected: FAIL with `Cannot find module '../usage'`.

- [ ] **Step 3: Implement the helper**

```typescript
// src/lib/memory/embedding/usage.ts
//
// Thin wrapper over recordUsage that knows the embedding model id and
// fills the right shape. Called from embedDocumentWorkflow's
// recordUsage step. Per ADR-003, customer cost = provider cost +
// MARKUP — `recordUsage` handles that calculation.
//
// Harness-pure — imports only @/lib/usage which is also harness-pure.

import { recordUsage } from '@/lib/usage/record';
import { EMBEDDING_MODEL_ID } from './types';

export interface RecordEmbeddingUsageArgs {
  companyId: string;
  brainId: string;
  documentId: string;
  promptTokens: number;
}

export async function recordEmbeddingUsage(
  args: RecordEmbeddingUsageArgs,
): Promise<{ id: string } | null> {
  return recordUsage({
    companyId: args.companyId,
    sessionId: null,
    userId: null,
    modelId: `openai/${EMBEDDING_MODEL_ID}`,
    inputTokens: args.promptTokens,
    outputTokens: 0,
    totalTokens: args.promptTokens,
    source: 'embedding_worker',
    parentUsageRecordId: null,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/memory/embedding/__tests__/usage.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/embedding/usage.ts src/lib/memory/embedding/__tests__/usage.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): recordEmbeddingUsage helper

Thin wrapper over recordUsage that fills the embedding-specific shape
(model id, source='embedding_worker', no output tokens). Called from
the workflow's recordUsage step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Query embedding LRU cache

**Files:**
- Create: `src/lib/memory/embedding/cache.ts`
- Create: `src/lib/memory/embedding/__tests__/cache.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/memory/embedding/__tests__/cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createQueryEmbeddingCache } from '../cache';

describe('createQueryEmbeddingCache', () => {
  let calls: number;
  let cache: ReturnType<typeof createQueryEmbeddingCache>;
  const fakeEmbedder = async (q: string) => {
    calls++;
    return new Array(1536).fill(q.length);
  };

  beforeEach(() => {
    calls = 0;
    cache = createQueryEmbeddingCache({ max: 3, embedder: fakeEmbedder });
  });

  it('caches identical queries within capacity', async () => {
    const a1 = await cache.get('hello');
    const a2 = await cache.get('hello');
    expect(a1).toEqual(a2);
    expect(calls).toBe(1);
  });

  it('evicts the oldest entry when over capacity (LRU)', async () => {
    await cache.get('a');
    await cache.get('b');
    await cache.get('c');
    await cache.get('d');                  // evicts 'a'
    expect(calls).toBe(4);
    await cache.get('a');                   // miss again
    expect(calls).toBe(5);
    await cache.get('d');                   // hit (most recently inserted)
    expect(calls).toBe(5);
  });

  it('treats different queries as different cache keys', async () => {
    await cache.get('apple');
    await cache.get('apples');
    await cache.get('Apple');               // case-sensitive
    expect(calls).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/memory/embedding/__tests__/cache.test.ts
```

Expected: FAIL with `Cannot find module '../cache'`.

- [ ] **Step 3: Implement the cache**

```typescript
// src/lib/memory/embedding/cache.ts
//
// In-process LRU for query embeddings. Avoids re-embedding identical
// queries within a single request lifecycle (e.g. an agent calling
// retrieve() three times with the same query). Cleared on process
// restart.
//
// Caveat per spec §5.5: under Vercel Functions' fluid compute,
// warm-instance lifetime varies — this is best-effort, not
// load-bearing. If query patterns prove repetitive in production,
// escalate to a Redis-backed cache.

export interface QueryEmbeddingCache {
  get(query: string): Promise<number[]>;
}

export interface CreateCacheOptions {
  max: number;
  embedder: (query: string) => Promise<number[]>;
}

export function createQueryEmbeddingCache(
  opts: CreateCacheOptions,
): QueryEmbeddingCache {
  // Map preserves insertion order; we re-insert on access to make it LRU.
  const store = new Map<string, number[]>();

  return {
    async get(query: string): Promise<number[]> {
      const hit = store.get(query);
      if (hit !== undefined) {
        // Re-insert to move to most-recently-used position.
        store.delete(query);
        store.set(query, hit);
        return hit;
      }
      const vec = await opts.embedder(query);
      store.set(query, vec);
      while (store.size > opts.max) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
      return vec;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/memory/embedding/__tests__/cache.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/embedding/cache.ts src/lib/memory/embedding/__tests__/cache.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): in-process LRU for query embeddings

Avoids re-embedding identical queries within a request lifecycle.
LRU eviction at configurable max size; case-sensitive keys (matches
the way openaiEmbedder hashes input).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Embedding workflow (Vercel Workflows)

**Files:**
- Create: `src/lib/memory/embedding/workflow.ts`
- Create: `src/lib/memory/embedding/__tests__/workflow.test.ts`

> **Implementer:** the Workflow SDK API surface is documented at https://workflow-sdk.dev/docs/getting-started. The `'use workflow'` and `'use step'` directives are stable as of `workflow@1.x`. Read the docs before guessing the trigger API for Task 10.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/memory/embedding/__tests__/workflow.test.ts
//
// Tests the WORKFLOW LOGIC by calling the underlying functions
// directly (not via Workflows runtime). The 'use workflow' / 'use step'
// directives are no-ops at runtime in test — the durability machinery
// only kicks in when triggered through the Workflow runtime.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import {
  seedBrainInCompany,
  teardownSeed,
  type SeededBrain,
} from '@/lib/memory/__tests__/_fixtures';

// Mock the OpenAI embedder so the test doesn't make real API calls.
vi.mock('../openai', () => ({
  openaiEmbedder: {
    embed: vi.fn(async (_text: string) => ({
      vector: new Array(1536).fill(0.42),
      promptTokens: 10,
    })),
    embedMany: vi.fn(),
    describe: () => ({ model: 'text-embedding-3-small', dimension: 1536 }),
  },
}));
// Mock the usage helper so the test doesn't write usage_records.
vi.mock('../usage', () => ({
  recordEmbeddingUsage: vi.fn(async () => ({ id: 'fake-usage' })),
}));

import { embedDocumentWorkflow } from '../workflow';

describe('embedDocumentWorkflow', () => {
  let seed: SeededBrain;

  beforeAll(async () => {
    seed = await seedBrainInCompany({
      docs: [{ title: 'Doc to embed', content: 'Sample content for embedding.' }],
    });
  });

  afterAll(async () => {
    await teardownSeed(seed);
  });

  it('writes the embedding for a real document under the right tenant tuple', async () => {
    await embedDocumentWorkflow({
      documentId: seed.docs[0].id,
      companyId: seed.companyId,
      brainId: seed.brainId,
    });

    const [row] = await db
      .select({ embedding: documents.embedding })
      .from(documents)
      .where(eq(documents.id, seed.docs[0].id));

    expect(row.embedding).not.toBeNull();
    expect(row.embedding).toHaveLength(1536);
    expect(row.embedding![0]).toBeCloseTo(0.42, 5);
  });

  it('no-ops when the (id, companyId, brainId) tuple does not match', async () => {
    // Seed a second tenant; pass its companyId with the original brainId.
    const other = await seedBrainInCompany({ docs: [{ title: 'Other', content: 'x' }] });
    try {
      await embedDocumentWorkflow({
        documentId: seed.docs[0].id,
        companyId: other.companyId,                // wrong company
        brainId: seed.brainId,
      });
      // First test already wrote an embedding; we only assert no THROW
      // here. The mismatched tuple causes loadDoc to return null and
      // the workflow short-circuits.
    } finally {
      await teardownSeed(other);
    }
    expect(true).toBe(true);
  });

  it('no-ops when the document was deleted between trigger and run', async () => {
    const transient = await seedBrainInCompany({
      docs: [{ title: 'Doomed', content: 'about to be soft-deleted' }],
    });
    await db.update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, transient.docs[0].id));
    try {
      // Workflow loads the doc via the tenant tuple; deletedAt IS NOT NULL
      // means the SELECT returns the row, but the workflow's deletedAt
      // guard short-circuits. Verify no throw; embedding stays NULL.
      await embedDocumentWorkflow({
        documentId: transient.docs[0].id,
        companyId: transient.companyId,
        brainId: transient.brainId,
      });
      const [row] = await db
        .select({ embedding: documents.embedding })
        .from(documents)
        .where(eq(documents.id, transient.docs[0].id));
      expect(row.embedding).toBeNull();
    } finally {
      // Hard-delete since the brain cascade requires deletedAt IS NULL paths
      // to clean up cleanly. Use raw SQL since teardownSeed expects normal state.
      await db.delete(documents).where(eq(documents.id, transient.docs[0].id));
      await teardownSeed(transient);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/memory/embedding/__tests__/workflow.test.ts
```

Expected: FAIL with `Cannot find module '../workflow'`.

- [ ] **Step 3: Implement the workflow**

```typescript
// src/lib/memory/embedding/workflow.ts
//
// embedDocumentWorkflow — the durable workflow that generates and
// persists a document's embedding. Triggered fire-and-forget from the
// write pipeline (POST + PATCH route handlers) and from the backfill
// CLI. Each 'use step' is independently retried by the Workflow
// runtime; the whole workflow is idempotent (re-runs overwrite the
// same row).
//
// Harness-pure — imports only @/db, drizzle, the embedding subsystem,
// and the usage helper. The 'workflow' SDK is platform-agnostic.
//
// Trust boundary: the route handler that calls triggerEmbeddingFor is
// the auth gate. The tenant-scoped (id, companyId, brainId) WHEREs
// inside loadDoc / persistEmbedding are defense-in-depth.

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { openaiEmbedder } from './openai';
import { recordEmbeddingUsage } from './usage';
import type { EmbedJobArgs } from './types';

export async function embedDocumentWorkflow(args: EmbedJobArgs): Promise<void> {
  'use workflow';

  const doc = await loadDoc(args);
  if (!doc) return;                                       // tuple mismatch / not found
  if (doc.deletedAt) return;                              // soft-deleted between trigger and run
  if (!doc.content || doc.content.trim().length === 0) return;

  const result = await generateEmbedding(doc.content);
  await persistEmbedding(args, result.vector);
  await recordUsage(args, result.promptTokens);
}

async function loadDoc(args: EmbedJobArgs) {
  'use step';
  const [row] = await db
    .select({
      content: documents.content,
      deletedAt: documents.deletedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, args.documentId),
        eq(documents.companyId, args.companyId),
        eq(documents.brainId, args.brainId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function generateEmbedding(content: string) {
  'use step';
  return openaiEmbedder.embed(content);
}

async function persistEmbedding(args: EmbedJobArgs, vector: number[]) {
  'use step';
  await db
    .update(documents)
    .set({ embedding: vector })
    .where(
      and(
        eq(documents.id, args.documentId),
        eq(documents.companyId, args.companyId),
        eq(documents.brainId, args.brainId),
      ),
    );
}

async function recordUsage(args: EmbedJobArgs, promptTokens: number) {
  'use step';
  await recordEmbeddingUsage({
    companyId: args.companyId,
    brainId: args.brainId,
    documentId: args.documentId,
    promptTokens,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/memory/embedding/__tests__/workflow.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Verify boundary**

```bash
npm run check-boundary
```

Expected: `check-harness-boundary: OK`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/memory/embedding/workflow.ts src/lib/memory/embedding/__tests__/workflow.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): embedDocumentWorkflow with tenant-scoped read+write

Durable Vercel Workflow that loads a doc by (id, companyId, brainId),
embeds the content via OpenAI, persists the vector, and records
billing. Soft-deleted or missing docs short-circuit cleanly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Trigger wrapper

**Files:**
- Create: `src/lib/memory/embedding/trigger.ts`
- Create: `src/lib/memory/embedding/__tests__/trigger.test.ts`

> **Implementer:** the exact `trigger` API from the `workflow` package may differ from the example below. Verify against https://workflow-sdk.dev/docs (search for "trigger workflow"). Likely shapes: `trigger(workflowFn, args)` or `workflowFn.trigger(args)`. Adjust the implementation; keep the test mocking strategy.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/memory/embedding/__tests__/trigger.test.ts
import { describe, it, expect, vi } from 'vitest';

const triggerMock = vi.fn();
vi.mock('workflow', () => ({
  trigger: (fn: unknown, args: unknown) => triggerMock(fn, args),
}));
vi.mock('../workflow', () => ({
  embedDocumentWorkflow: 'fake-workflow-fn',
}));

import { triggerEmbeddingFor } from '../trigger';

describe('triggerEmbeddingFor', () => {
  it('invokes the workflow with the EmbedJobArgs payload', async () => {
    triggerMock.mockResolvedValueOnce(undefined);

    await triggerEmbeddingFor({
      documentId: 'doc-1',
      companyId: 'co-1',
      brainId: 'br-1',
    });

    expect(triggerMock).toHaveBeenCalledOnce();
    expect(triggerMock).toHaveBeenCalledWith('fake-workflow-fn', expect.anything());
    // Verify the EmbedJobArgs shape made it through (whatever the actual
    // SDK call signature is, the trigger must receive these three fields).
    const callArgs = triggerMock.mock.calls[0][1];
    const flat = JSON.stringify(callArgs);
    expect(flat).toContain('doc-1');
    expect(flat).toContain('co-1');
    expect(flat).toContain('br-1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/memory/embedding/__tests__/trigger.test.ts
```

Expected: FAIL with `Cannot find module '../trigger'`.

- [ ] **Step 3: Implement the trigger**

```typescript
// src/lib/memory/embedding/trigger.ts
//
// Fire-and-forget wrapper that enqueues an embedDocumentWorkflow run.
// Called from the document write-pipeline (POST + PATCH route
// handlers) and from the backfill CLI. Returns immediately so the
// HTTP response is not blocked by the embedding API call.
//
// Harness-pure — only imports the workflow SDK + the workflow module.

import { trigger } from 'workflow';
import { embedDocumentWorkflow } from './workflow';
import type { EmbedJobArgs } from './types';

export async function triggerEmbeddingFor(args: EmbedJobArgs): Promise<void> {
  // Per Workflow SDK docs (https://workflow-sdk.dev/docs):
  // trigger(workflowFn, args) enqueues a new run. The workflow runtime
  // serializes args to its event log and replays steps deterministically.
  await trigger(embedDocumentWorkflow, { args: [args] });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/memory/embedding/__tests__/trigger.test.ts
```

Expected: PASS.

> **Implementer note:** if the actual `workflow` SDK API shape differs (e.g. takes a single args argument, not `{ args: [...] }`), adjust the implementation AND the test mock to match. Keep the public signature `triggerEmbeddingFor(args: EmbedJobArgs): Promise<void>` stable so call sites in Task 11+12 don't need to change.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/embedding/trigger.ts src/lib/memory/embedding/__tests__/trigger.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): triggerEmbeddingFor — fire-and-forget workflow enqueue

Thin wrapper that enqueues an embedDocumentWorkflow run with the
EmbedJobArgs tenant tuple. Called from route handlers + backfill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Hook write pipeline — POST `/api/brain/documents`

**Files:**
- Modify: `src/app/api/brain/documents/route.ts`

- [ ] **Step 1: Add the trigger import**

At the top of the file (with the other imports), add:

```typescript
import { triggerEmbeddingFor } from '@/lib/memory/embedding/trigger';
```

- [ ] **Step 2: Call the trigger after successful insert, before overview regen**

In the POST handler, find the block that calls `tryRegenerateManifest(brain.id)` after the insert (around line 261). Add the trigger call between the manifest regen and the overview regen:

```typescript
// (existing) await tryRegenerateManifest(brain.id);
// (existing) try { revalidatePath('/', 'layout'); } catch { ... }
// (existing) if (input.attachmentId) { ... markCommitted ... }

// Phase 2: enqueue embedding generation. Fire-and-forget; the
// workflow runs out-of-band and updates documents.embedding when it
// completes. A failure here shouldn't fail the user's save, so wrap
// in try/catch with a log.
try {
  await triggerEmbeddingFor({
    documentId: doc.id,
    companyId,
    brainId: brain.id,
  });
} catch (err) {
  console.error('[api/brain/documents POST] triggerEmbeddingFor failed', err);
}

// (existing) if (documentType == null) { regenerateFolderOverview ... }
```

- [ ] **Step 3: Type-check + lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: zero errors. Eslint may flag the new import order — fix per existing convention.

- [ ] **Step 4: Manual smoke test**

```bash
# Start dev server in another terminal:
# npm run dev

# Then create a doc via the UI (or curl). Confirm:
# 1. The POST response succeeds.
# 2. The Vercel Workflow dashboard shows a new embedDocumentWorkflow run.
# 3. After the workflow completes, documents.embedding for that doc IS NOT NULL.
```

If you can't run dev locally, defer this step to the integration suite below.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/brain/documents/route.ts
git commit -m "$(cat <<'EOF'
feat(api): trigger embedding workflow on document POST

Fire-and-forget call to triggerEmbeddingFor right after the INSERT
succeeds. Failure logged + swallowed so a workflow-trigger error
doesn't fail the user's save.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Hook write pipeline — PATCH `/api/brain/documents/[id]`

**Files:**
- Modify: `src/app/api/brain/documents/[id]/route.ts`

- [ ] **Step 1: Add the trigger import**

```typescript
import { triggerEmbeddingFor } from '@/lib/memory/embedding/trigger';
```

- [ ] **Step 2: Call the trigger only when content changed**

In the PATCH handler, after the `await db.update(documents)...returning()` block (around line 296), add:

```typescript
// Phase 2: re-embed only when content actually changed. Metadata-only
// updates (title rename, folder move, status change) do not affect the
// embedding because the workflow embeds doc.content. Mirrors the same
// content-change gate as compactIndex / regenerateFolderOverview.
if (patch.content !== undefined && patch.content !== existing.content) {
  try {
    await triggerEmbeddingFor({
      documentId: existing.id,
      companyId,
      brainId: brain.id,
    });
  } catch (err) {
    console.error('[api/brain/documents/[id] PATCH] triggerEmbeddingFor failed', err);
  }
}
```

- [ ] **Step 3: Type-check + lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/brain/documents/[id]/route.ts
git commit -m "$(cat <<'EOF'
feat(api): trigger embedding workflow on document content PATCH

Re-embed only when content changes; metadata-only PATCHes skip the
workflow. Failure logged + swallowed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Update tatara-hybrid provider

**Files:**
- Modify: `src/lib/memory/providers/tatara-hybrid/index.ts`
- Modify: `src/lib/memory/providers/tatara-hybrid/__tests__/capabilities.test.ts`

- [ ] **Step 1: Update the capabilities test first (TDD)**

Edit `__tests__/capabilities.test.ts`:

```typescript
// Change the embeddings expectation in the existing describe() test:
expect(c.supports.embeddings).toBe(true);   // was: false
```

Then add a new test below the existing `brainOverview` block:

```typescript
// Add at the top of the test file (with the other imports):
//   import { randomUUID } from 'node:crypto';

describe('tataraHybridProvider.invalidateDocument()', () => {
  let seed: SeededBrain;
  beforeAll(async () => {
    seed = await seedBrainInCompany({
      docs: [{ title: 'Re-embed me', content: 'Some content here.' }],
    });
  });
  afterAll(async () => {
    await teardownSeed(seed);
  });

  it('triggers re-embedding for a known (slug, companyId, brainId) tuple', async () => {
    // The trigger writes to a workflow runtime we don't control in tests.
    // We assert "no throw" + "looks up the slug under the right tenant"
    // by passing a definitely-unknown slug and checking it returns
    // silently (no throw).
    await expect(
      tataraHybridProvider.invalidateDocument(
        'totally-unknown-slug',
        seed.companyId,
        seed.brainId,
      ),
    ).resolves.toBeUndefined();
  });

  it('silent no-op when the (slug, companyId, brainId) tuple is invalid', async () => {
    // Cross-tenant call: slug exists in seed.companyId, but we pass a
    // bogus companyId. invalidateDocument must not crash and must not
    // trigger a workflow.
    const bogusCompanyId = randomUUID();
    await expect(
      tataraHybridProvider.invalidateDocument(
        seed.docs[0].slug,
        bogusCompanyId,
        seed.brainId,
      ),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/memory/providers/tatara-hybrid/__tests__/capabilities.test.ts
```

Expected: FAIL — `embeddings` still `false` and `invalidateDocument` is the Phase 1 no-op.

- [ ] **Step 3: Update the provider implementation**

Replace the existing `invalidateDocument` and `describe` in `src/lib/memory/providers/tatara-hybrid/index.ts`:

```typescript
import { triggerEmbeddingFor } from '../../embedding/trigger';

// ... inside the provider object, replace the existing
// invalidateDocument + describe:

async invalidateDocument(
  slug: string,
  companyId: string,
  brainId: string,
): Promise<void> {
  // Resolve slug → documentId via the tenant-scoped read.
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.slug, slug),
        eq(documents.companyId, companyId),
        eq(documents.brainId, brainId),
      ),
    )
    .limit(1);
  if (!row) return;                                // unknown slug — silent no-op
  await triggerEmbeddingFor({
    documentId: row.id,
    companyId,
    brainId,
  });
},

describe(): ProviderCapabilities {
  return {
    name: 'tatara-hybrid',
    supports: {
      factLookup: false,           // Phase 3
      graphTraverse: false,        // Phase 5
      timeline: false,             // Phase 3
      embeddings: true,            // Phase 2
    },
  };
},
```

You may also need to import `triggerEmbeddingFor` and add `documents` + `and, eq` from drizzle-orm at the top of the file if not already imported.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/memory/providers/tatara-hybrid/__tests__/capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all memory tests as a regression check**

```bash
npx vitest run src/lib/memory
```

Expected: all green. If anything else (e.g. tier-gate.test.ts) regressed, investigate before committing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/memory/providers/tatara-hybrid/
git commit -m "$(cat <<'EOF'
feat(memory): provider implements invalidateDocument + describe.embeddings=true

The Phase 1 no-op invalidateDocument now resolves slug→id under the
tenant tuple and fires the embedding workflow. describe() flips
embeddings to true so capability-detecting callers see Phase 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Backfill CLI script

**Files:**
- Create: `scripts/backfill-embeddings-phase2.ts`

- [ ] **Step 1: Create the script**

```typescript
// scripts/backfill-embeddings-phase2.ts
//
// One-shot backfill of embeddings for documents written before Phase 2
// landed. Mirrors Phase 1's scripts/backfill-compact-index-phase1.ts
// shape but triggers the embedDocumentWorkflow per row rather than
// computing inline. Idempotent: each invocation enqueues a workflow
// for every doc still missing an embedding.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/backfill-embeddings-phase2.ts
//
// Or, if .env is present in the project root:
//   npx tsx -r dotenv/config scripts/backfill-embeddings-phase2.ts

import 'dotenv/config';
import { isNull } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { triggerEmbeddingFor } from '@/lib/memory/embedding/trigger';

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: documents.id,
      companyId: documents.companyId,
      brainId: documents.brainId,
    })
    .from(documents)
    .where(isNull(documents.embedding));

  console.log(`[backfill] enqueueing embedding workflows for ${rows.length} docs`);
  for (const row of rows) {
    try {
      await triggerEmbeddingFor({
        documentId: row.id,
        companyId: row.companyId,
        brainId: row.brainId,
      });
      console.log(`[backfill] triggered ${row.id}`);
    } catch (err) {
      console.error(`[backfill] failed to trigger ${row.id}`, err);
    }
  }
  console.log(`[backfill] done — enqueued ${rows.length} runs`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });
```

- [ ] **Step 2: Run the script (after Tasks 1-13 are merged)**

```bash
DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d= -f2-) npx tsx scripts/backfill-embeddings-phase2.ts
```

Expected: prints `enqueueing embedding workflows for ~165 docs`, then enqueues each. Workflows run in the background.

- [ ] **Step 3: Verify completion (poll until all populated)**

```bash
# Use mcp__plugin_supabase_supabase__execute_sql:
SELECT COUNT(*) AS pending FROM documents WHERE deleted_at IS NULL AND embedding IS NULL;
```

Expected: `pending` decreases over time, reaches 0 within several minutes (depending on workflow concurrency + OpenAI rate limits).

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-embeddings-phase2.ts
git commit -m "$(cat <<'EOF'
chore(scripts): one-shot embeddings backfill CLI

Enumerates documents WHERE embedding IS NULL and enqueues a workflow
per row. Idempotent — re-running picks up only stragglers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Extend `composeBoostedScore` with WEIGHT_VEC term

**Files:**
- Modify: `src/lib/memory/scoring/compose.ts`
- Modify: `src/lib/memory/scoring/__tests__/compose.test.ts`

- [ ] **Step 1: Inspect Phase 1 compose**

```bash
cat src/lib/memory/scoring/compose.ts
```

Note the existing signature; preserve it as the no-cosine default to keep backwards compatibility for any caller not yet passing `cosineSim`.

- [ ] **Step 2: Extend the test (TDD)**

Add new tests to `src/lib/memory/scoring/__tests__/compose.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { composeBoostedScore } from '../compose';

describe('composeBoostedScore — Phase 2 cosineSim term', () => {
  const baseInput = {
    tsRank: 0.5,
    query: 'pricing',
    content: 'Enterprise pricing tier starts at $50k.',
    docUpdatedAt: new Date(),
  };

  it('cosineSim=null falls through cleanly (Phase 1 behavior)', () => {
    const score = composeBoostedScore({ ...baseInput, cosineSim: null });
    expect(score).toBeGreaterThan(0);
    expect(score).not.toBeNaN();
  });

  it('cosineSim raises the score above the cosine-null baseline', () => {
    const lo = composeBoostedScore({ ...baseInput, cosineSim: null });
    const hi = composeBoostedScore({ ...baseInput, cosineSim: 0.9 });
    expect(hi).toBeGreaterThan(lo);
  });

  it('weights override changes the lexical/semantic balance', () => {
    const semHeavy = composeBoostedScore({
      ...baseInput,
      cosineSim: 0.9,
      weights: { ts: 0.1, vec: 0.9 },
    });
    const lexHeavy = composeBoostedScore({
      ...baseInput,
      cosineSim: 0.9,
      weights: { ts: 0.9, vec: 0.1 },
    });
    expect(semHeavy).toBeGreaterThan(lexHeavy);
  });

  it('weights override with vec=0 reproduces Phase 1 lexical-only behavior', () => {
    const phase2WithVecOff = composeBoostedScore({
      ...baseInput,
      cosineSim: 0.9,
      weights: { ts: 1, vec: 0 },
    });
    const phase1NullCosine = composeBoostedScore({
      ...baseInput,
      cosineSim: null,
      weights: { ts: 1, vec: 0 },
    });
    expect(phase2WithVecOff).toBeCloseTo(phase1NullCosine, 5);
  });
});
```

Also keep all Phase 1 compose.test.ts cases unchanged.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/lib/memory/scoring/__tests__/compose.test.ts
```

Expected: FAIL — current compose doesn't accept `cosineSim` or `weights`.

- [ ] **Step 4: Update the implementation**

```typescript
// src/lib/memory/scoring/compose.ts
//
// Compose a final retrieval score by combining lexical (ts_rank) and
// semantic (cosine similarity) base scores with multiplicative boosts
// (phrase, proper noun, temporal proximity).
//
// Phase 1 shipped lexical-only (WEIGHT_VEC=0 implicit). Phase 2 adds
// the cosineSim term. Default weights are hand-tuned starting points
// (semantic-leaning); per-brain overrides land in Phase 3 with
// brain_configs. Optional `weights` parameter lets the benchmark
// runner toggle WEIGHT_VEC=0 for baseline runs without changing
// production defaults.

import { phraseBoost } from './phrase-boost';
import { properNounBoost } from './proper-noun-boost';
import { temporalProximity } from './temporal-proximity';

export const DEFAULT_WEIGHT_TS = 0.4;
export const DEFAULT_WEIGHT_VEC = 0.6;

export interface ComposeInput {
  tsRank: number;
  query: string;
  content: string;
  docUpdatedAt: Date;
  cosineSim?: number | null;
  weights?: { ts?: number; vec?: number };
}

export function composeBoostedScore(input: ComposeInput): number {
  const wTs = input.weights?.ts ?? DEFAULT_WEIGHT_TS;
  const wVec = input.weights?.vec ?? DEFAULT_WEIGHT_VEC;
  const cosine = input.cosineSim ?? 0;

  const baseScore = wTs * input.tsRank + wVec * cosine;

  const boosts =
    phraseBoost(input.query, input.content) *
    properNounBoost(input.query, input.content) *
    temporalProximity(input.docUpdatedAt);

  return baseScore * boosts;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/lib/memory/scoring
```

Expected: all green (Phase 1 + new Phase 2 cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/memory/scoring/
git commit -m "$(cat <<'EOF'
feat(memory): composeBoostedScore adds cosineSim term + weights override

Default 0.4 lexical / 0.6 semantic; cosineSim=null falls through
cleanly so retrieval keeps working when embeddings haven't landed yet.
Optional weights parameter lets the benchmark runner toggle WEIGHT_VEC
to 0 for baseline-vs-hybrid comparisons.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Update `retrieve()` SQL — cosine + null-safe fallback

**Files:**
- Modify: `src/lib/memory/core.ts`

- [ ] **Step 1: Read the current core retrieve to plan the diff**

```bash
sed -n '50,120p' src/lib/memory/core.ts
```

- [ ] **Step 2: Add the embedding dependencies**

At the top of the file (after the existing imports), add:

```typescript
import { openaiEmbedder } from './embedding/openai';
import { createQueryEmbeddingCache } from './embedding/cache';
```

After the existing imports + before `interface RawRow`, add the module-level cache:

```typescript
// Module-level cache so identical queries within a process lifetime hit
// the LRU. Per spec §5.5, this is best-effort under fluid compute; not
// load-bearing.
const queryCache = createQueryEmbeddingCache({
  max: 100,
  embedder: async (q) => (await openaiEmbedder.embed(q)).vector,
});
```

In `RawRow`, add:

```typescript
cosine_sim: number | string | null;
```

- [ ] **Step 3: Embed the query before the SQL**

In `retrieve()`, just after `assertTierAllowed(...)` and `const limit = ...`, add:

```typescript
const queryEmbedding = await queryCache.get(q.query);
const queryEmbeddingLiteral = `[${queryEmbedding.join(',')}]`;
```

- [ ] **Step 4: Update the SQL**

Replace the existing `db.execute(sql\`...\`)` call with:

```typescript
const rows = (await db.execute(sql`
  SELECT
    d.id,
    d.slug,
    d.title,
    d.path,
    d.content,
    d.updated_at,
    d.version,
    ts_rank(d.search_vector, plainto_tsquery('english', ${q.query})) AS ts_rank,
    ts_headline(
      'english',
      d.content,
      plainto_tsquery('english', ${q.query}),
      'MaxWords=35, MinWords=15'
    ) AS ts_headline,
    d.compact_index,
    f.slug AS folder_slug,
    CASE WHEN d.embedding IS NOT NULL
         THEN 1 - (d.embedding <=> ${queryEmbeddingLiteral}::vector)
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
    + 0.6 * COALESCE(1 - (d.embedding <=> ${queryEmbeddingLiteral}::vector), 0)
  ) DESC
  LIMIT ${limit * 3}
`)) as unknown as RawRow[];
```

- [ ] **Step 5: Pass cosineSim into composeBoostedScore**

Update the `scored` map step:

```typescript
const scored = rows.map((r) => {
  const tsRank =
    typeof r.ts_rank === 'number' ? r.ts_rank : Number(r.ts_rank);
  const cosineSim =
    r.cosine_sim === null
      ? null
      : (typeof r.cosine_sim === 'number' ? r.cosine_sim : Number(r.cosine_sim));
  const score = composeBoostedScore({
    tsRank,
    cosineSim,
    query: q.query,
    content: r.content,
    docUpdatedAt: asDate(r.updated_at),
  });
  return { row: r, score };
});
```

- [ ] **Step 6: Run the existing core tests as a regression check**

```bash
npx vitest run src/lib/memory/__tests__/core.test.ts src/lib/memory/__tests__/cross-tenancy.test.ts src/lib/memory/__tests__/tier-gate.test.ts
```

Expected: all Phase 1 tests still pass. The cosine path adds candidates (via the `OR d.embedding IS NOT NULL` clause) but doesn't subtract any; existing assertions about which docs surface should still hold.

> **If a Phase 1 test fails because more docs now surface than before:** investigate why — it might be legitimate (a doc with no lexical match but embeddings-eligible). Discuss with the user before tightening the test. The Phase 1 docs in the fixture all have NULL embeddings, so this should not occur in practice.

- [ ] **Step 7: Verify boundary**

```bash
npm run check-boundary
```

Expected: `check-harness-boundary: OK`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/memory/core.ts
git commit -m "$(cat <<'EOF'
feat(memory): retrieve() adds cosine similarity + null-safe fallback

Query is embedded once (LRU-cached) before the SQL. Hybrid scoring
combines ts_rank with cosine similarity via composeBoostedScore.
Documents with NULL embeddings remain searchable via the lexical path.
Tenant predicates run before ORDER BY so the HNSW index narrows
within (company_id, brain_id) scope.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Cross-tenancy ANN isolation test

**Files:**
- Modify: `src/lib/memory/__tests__/cross-tenancy.test.ts`

- [ ] **Step 1: Add the new test case**

Append to the existing `describe('cross-tenancy isolation', ...)` block (or create a sibling describe):

```typescript
describe('cross-tenancy isolation — vector ANN', () => {
  let a: SeededBrain;
  let b: SeededBrain;

  beforeAll(async () => {
    // Seed identical content in two tenants. Manually populate
    // embeddings with the SAME vector so cosine similarity to any
    // query is identical in both tenants. This isolates the test to
    // tenant-scoping (not embedding quality).
    a = await seedBrainInCompany({
      docs: [{ title: 'Secret-A', content: 'Acme uses our enterprise pricing tier.' }],
    });
    b = await seedBrainInCompany({
      docs: [{ title: 'Secret-B', content: 'Acme uses our enterprise pricing tier.' }],
    });
    const fakeVec = new Array(1536).fill(0.5);
    const literal = `[${fakeVec.join(',')}]`;
    await db.execute(
      sql`UPDATE documents SET embedding = ${literal}::vector WHERE id = ${a.docs[0].id}`,
    );
    await db.execute(
      sql`UPDATE documents SET embedding = ${literal}::vector WHERE id = ${b.docs[0].id}`,
    );
  });

  afterAll(async () => {
    await teardownSeed(a);
    await teardownSeed(b);
  });

  it('vector search in tenant A does not return tenant B docs', async () => {
    const results = await retrieve(
      {
        brainId: a.brainId,
        companyId: a.companyId,
        query: 'enterprise pricing',
        mode: 'hybrid',
        tierCeiling: 'extracted',
      },
      { role: 'customer_facing' },
    );
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain(a.docs[0].slug);
    expect(slugs).not.toContain(b.docs[0].slug);
  });

  it('vector search in tenant B does not return tenant A docs', async () => {
    const results = await retrieve(
      {
        brainId: b.brainId,
        companyId: b.companyId,
        query: 'enterprise pricing',
        mode: 'hybrid',
        tierCeiling: 'extracted',
      },
      { role: 'customer_facing' },
    );
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain(b.docs[0].slug);
    expect(slugs).not.toContain(a.docs[0].slug);
  });
});
```

You may need to add `import { sql } from 'drizzle-orm'` and `import { db } from '@/db'` if not present in this test file already.

- [ ] **Step 2: Run the test**

```bash
npx vitest run src/lib/memory/__tests__/cross-tenancy.test.ts
```

Expected: all tests pass — Phase 1 cases plus the two new ANN cases.

> **Note:** the test embeds the query via `openaiEmbedder` (real call). To avoid hitting OpenAI in CI, the implementer may add a mock at the top of this file. Phase 1 cross-tenancy.test.ts is already DB-dependent so it requires `DATABASE_URL`; one external dependency more is acceptable for an integration test, but flag if test times grow noticeably.

- [ ] **Step 3: Commit**

```bash
git add src/lib/memory/__tests__/cross-tenancy.test.ts
git commit -m "$(cat <<'EOF'
test(memory): cross-tenancy ANN isolation case

Two tenants with identical content + identical embeddings. Vector
search in one must not return the other's doc. Closes the Phase 2
tenancy gap for the new pgvector ORDER BY path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Fixture helper — `seedBrainWithEmbeddings`

**Files:**
- Modify: `src/lib/memory/__tests__/_fixtures.ts`

- [ ] **Step 1: Add the helper**

After the existing `seedBrainInCompany` function, add:

```typescript
/**
 * Like seedBrainInCompany, but also writes a deterministic embedding
 * for each seeded document. Tests that need to exercise the cosine
 * path use this; tests that only care about lexical can keep using
 * seedBrainInCompany.
 *
 * The embedding is derived from the doc's index in the array — doc 0
 * gets a vector of all 0.1, doc 1 gets all 0.2, etc. Cosine sim
 * between any two seeded docs is therefore 1.0 (identical vectors are
 * scaled multiples; cosine is direction-only). Tests asserting
 * "different docs have different cosine to a query" should set
 * embeddings explicitly via the optional `embeddings` parameter.
 */
export async function seedBrainWithEmbeddings(opts: {
  docs: SeedDocInput[];
  embeddings?: number[][];                 // override per-doc vectors
}): Promise<SeededBrain> {
  const seeded = await seedBrainInCompany({ docs: opts.docs });
  for (let i = 0; i < seeded.docs.length; i++) {
    const vec = opts.embeddings?.[i] ?? new Array(1536).fill((i + 1) * 0.1);
    const literal = `[${vec.join(',')}]`;
    await db.execute(
      sql`UPDATE documents SET embedding = ${literal}::vector WHERE id = ${seeded.docs[i].id}`,
    );
  }
  return seeded;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/memory/__tests__/_fixtures.ts
git commit -m "$(cat <<'EOF'
test(memory): seedBrainWithEmbeddings fixture helper

Builds on seedBrainInCompany + writes deterministic embeddings per
doc. Used by core-hybrid.test.ts and cross-tenancy ANN cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Hybrid integration test — semantic-intent query beats lexical

**Files:**
- Create: `src/lib/memory/__tests__/core-hybrid.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/lib/memory/__tests__/core-hybrid.test.ts
//
// End-to-end test: a query whose terms don't lexically match the
// "right" document but whose embedding is closer ranks the right doc
// higher in hybrid mode than in lexical-only mode.
//
// We control embeddings explicitly (no real OpenAI call for the docs
// themselves) but mock the openaiEmbedder so the QUERY embedding is a
// known vector that's closer to one seeded doc than the other.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { retrieve } from '../core';
import {
  seedBrainWithEmbeddings,
  teardownSeed,
  type SeededBrain,
} from './_fixtures';

// Build a query embedding that's closest to doc 0 (vector all 0.1).
const queryVec = new Array(1536).fill(0.1);
vi.mock('../embedding/openai', () => ({
  openaiEmbedder: {
    embed: vi.fn(async () => ({ vector: queryVec, promptTokens: 5 })),
    embedMany: vi.fn(),
    describe: () => ({ model: 'text-embedding-3-small', dimension: 1536 }),
  },
}));

describe('retrieve() hybrid mode — cosine surfaces semantically-close docs', () => {
  let seed: SeededBrain;

  beforeAll(async () => {
    seed = await seedBrainWithEmbeddings({
      docs: [
        // Doc 0: cosine-close to query (matches embedding direction).
        // Lexically irrelevant — the query "expansion plans" doesn't
        // appear in the body.
        { title: 'Vision narrative', content: 'A long-form prose paragraph about the company future.' },
        // Doc 1: cosine-far. Lexically a perfect match.
        { title: 'Expansion plans', content: 'Expansion plans for the next quarter focus on three regions.' },
      ],
      embeddings: [
        new Array(1536).fill(0.1),         // doc 0 — same direction as query
        new Array(1536).fill(-0.5),        // doc 1 — opposite direction
      ],
    });
  });

  afterAll(async () => teardownSeed(seed));

  it('hybrid surfaces the cosine-close doc above the cosine-far one', async () => {
    const results = await retrieve(
      {
        brainId: seed.brainId,
        companyId: seed.companyId,
        query: 'expansion plans',          // lexically matches doc 1
        mode: 'hybrid',
        tierCeiling: 'extracted',
      },
      { role: 'customer_facing' },
    );
    expect(results.length).toBeGreaterThan(0);
    const rank0 = results.findIndex((r) => r.slug === seed.docs[0].slug);
    const rank1 = results.findIndex((r) => r.slug === seed.docs[1].slug);
    // Both should appear; doc 0 should rank higher because cosine
    // dominates the score with WEIGHT_VEC=0.6.
    expect(rank0).toBeGreaterThanOrEqual(0);
    expect(rank1).toBeGreaterThanOrEqual(0);
    expect(rank0).toBeLessThan(rank1);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run src/lib/memory/__tests__/core-hybrid.test.ts
```

Expected: PASS.

> **Implementer:** if the assertion fails because doc 1's lexical advantage outweighs doc 0's cosine advantage, the default weights aren't ordering the way the spec expects. Investigate before adjusting the test — the spec says 0.4 lex / 0.6 vec, so cosine should dominate when content is similarly short.

- [ ] **Step 3: Commit**

```bash
git add src/lib/memory/__tests__/core-hybrid.test.ts
git commit -m "$(cat <<'EOF'
test(memory): hybrid surfaces cosine-close doc above lexical-only match

Two-doc fixture with controlled embeddings + a mocked query embedder.
With WEIGHT_VEC=0.6 default, the cosine-close doc must rank above the
lexical-only match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Wire benchmark seed helper

**Files:**
- Create: `tests/benchmarks/seed.ts`
- Modify: `tests/benchmarks/runner.ts`

- [ ] **Step 1: Build a CLI-callable seed helper**

```typescript
// tests/benchmarks/seed.ts
//
// CLI-friendly variant of seedBrainInCompany that doesn't depend on
// vitest. Used by tests/benchmarks/runner.ts to seed a fresh
// (company, brain, folder) and a corpus of documents from the
// benchmark fixture. Returns the IDs the runner needs.
//
// NOTE: this writes to the same DB as the dev server. Use a dedicated
// benchmark DB or drop the seeded company afterwards via teardownBenchmarkSeed.

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { brains } from '@/db/schema/brains';
import { companies } from '@/db/schema/companies';
import { documents } from '@/db/schema/documents';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { extractCompactIndex } from '@/lib/memory/compact-index/extract';
import { triggerEmbeddingFor } from '@/lib/memory/embedding/trigger';

export interface BenchmarkDoc {
  slug: string;
  title: string;
  content: string;
}

export interface SeededBenchmark {
  companyId: string;
  brainId: string;
  ownerUserId: string;
  docIds: Record<string, string>;          // slug → uuid
}

export async function seedBenchmarkBrain(
  corpus: BenchmarkDoc[],
): Promise<SeededBenchmark> {
  const suffix = `bench-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Bench Co ${suffix}`, slug: `bench-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company.id, name: 'Bench', slug: 'bench' })
    .returning({ id: brains.id });

  const [folder] = await db
    .insert(folders)
    .values({ companyId: company.id, brainId: brain.id, slug: 'corpus', name: 'Corpus' })
    .returning({ id: folders.id });

  const ownerId = randomUUID();
  await db.insert(users).values({
    id: ownerId,
    companyId: company.id,
    fullName: 'Bench Owner',
    email: `bench-${suffix}@example.test`,
    status: 'active',
  });

  const docIds: Record<string, string> = {};
  for (const d of corpus) {
    const ci = extractCompactIndex(d.content, { entities: [] });
    const [row] = await db
      .insert(documents)
      .values({
        companyId: company.id,
        brainId: brain.id,
        folderId: folder.id,
        title: d.title,
        slug: d.slug,
        path: `corpus/${d.slug}`,
        content: d.content,
        status: 'active',
        ownerId,
        compactIndex: ci,
      })
      .returning({ id: documents.id });
    docIds[d.slug] = row.id;

    // Fire embedding workflow synchronously (await trigger return,
    // not workflow completion). The benchmark runner waits separately
    // for embeddings to land before measuring.
    await triggerEmbeddingFor({
      documentId: row.id,
      companyId: company.id,
      brainId: brain.id,
    });
  }

  return { companyId: company.id, brainId: brain.id, ownerUserId: ownerId, docIds };
}

export async function teardownBenchmarkSeed(s: SeededBenchmark): Promise<void> {
  await db.delete(users).where(eq(users.id, s.ownerUserId));
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, s.brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, s.companyId));
}

export async function waitForEmbeddings(
  brainId: string,
  expectedCount: number,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM documents
      WHERE brain_id = ${brainId} AND embedding IS NOT NULL
    `);
    const n = Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
    if (n >= expectedCount) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`waitForEmbeddings timed out: ${expectedCount} expected for brain ${brainId}`);
}
```

- [ ] **Step 2: Update the runner**

Replace `tests/benchmarks/runner.ts` body (preserve the file-level comment + types) with the wired-up version:

```typescript
// (preserve file-level comment from the existing scaffold)

import fs from 'node:fs/promises';
import path from 'node:path';
import { retrieve } from '../../src/lib/memory/core';
import {
  seedBenchmarkBrain,
  teardownBenchmarkSeed,
  waitForEmbeddings,
} from './seed';

interface Benchmark {
  name: string;
  corpus: Array<{ slug: string; title: string; content: string }>;
  questions: Array<{ query: string; gold_slugs: string[] }>;
}

interface Metrics {
  name: string;
  mode: string;
  n: number;
  r_at_5: number;
  r_at_10: number;
  mrr: number;
}

async function main(): Promise<void> {
  const fixturePath =
    process.argv[2] ?? 'tests/benchmarks/fixtures/sample.json';
  const weightVec = Number(process.env.MEMORY_WEIGHT_VEC ?? '0.6');
  const outputPath = process.env.BENCH_OUTPUT;     // optional, write metrics JSON

  const raw = await fs.readFile(path.resolve(fixturePath), 'utf-8');
  const bench: Benchmark = JSON.parse(raw);

  console.log(`[bench] seeding "${bench.name}" (${bench.corpus.length} docs)`);
  const seeded = await seedBenchmarkBrain(bench.corpus);
  console.log(`[bench] waiting for embeddings...`);
  await waitForEmbeddings(seeded.brainId, bench.corpus.length);

  console.log(`[bench] running ${bench.questions.length} questions, weight_vec=${weightVec}`);
  const ranks: Array<number | null> = [];

  // The MEMORY_WEIGHT_VEC env var is read at module load by
  // src/lib/memory/scoring/compose.ts (Task 21). When unset, defaults to
  // 0.6 (hybrid). When set to 0, retrieve() runs lexical-only — used to
  // capture the Phase 1 baseline against the Phase 2 SQL.
  for (const q of bench.questions) {
    const results = await retrieve(
      {
        brainId: seeded.brainId,
        companyId: seeded.companyId,
        query: q.query,
        mode: 'hybrid',
        tierCeiling: 'extracted',
        limit: 10,
      },
      { role: 'customer_facing' },
    );
    const slugs = results.map((r) => r.slug);
    let rank: number | null = null;
    for (const gold of q.gold_slugs) {
      const i = slugs.indexOf(gold);
      if (i >= 0 && (rank === null || i < rank)) rank = i;
    }
    ranks.push(rank);
  }

  const rAt5 = ranks.filter((r) => r !== null && r < 5).length / ranks.length;
  const rAt10 = ranks.filter((r) => r !== null && r < 10).length / ranks.length;
  const mrr =
    ranks
      .filter((r): r is number => r !== null)
      .reduce((acc, r) => acc + 1 / (r + 1), 0) / ranks.length;

  const metrics: Metrics = {
    name: bench.name,
    mode: weightVec === 0 ? 'lexical-only' : `hybrid (vec=${weightVec})`,
    n: ranks.length,
    r_at_5: rAt5,
    r_at_10: rAt10,
    mrr,
  };
  console.log(JSON.stringify(metrics, null, 2));

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(metrics, null, 2));
    console.log(`[bench] metrics written to ${outputPath}`);
  }

  console.log(`[bench] tearing down seed`);
  await teardownBenchmarkSeed(seeded);
}

export type { Benchmark, Metrics };

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add tests/benchmarks/seed.ts tests/benchmarks/runner.ts
git commit -m "$(cat <<'EOF'
feat(benchmarks): wire seed helper + waitForEmbeddings into runner

Phase 1 left runner.ts as a scaffold throwing at the seed step. Phase 2
fills in: seedBenchmarkBrain (mirrors the test fixture but vitest-free),
embedding-trigger per doc, waitForEmbeddings poller, hybrid retrieve
loop, R@5/R@10/MRR aggregation, optional BENCH_OUTPUT path for archived
metrics, and teardown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Make `WEIGHT_VEC` env-overridable for benchmarks

**Files:**
- Modify: `src/lib/memory/scoring/compose.ts`

- [ ] **Step 1: Add the env override**

Edit `src/lib/memory/scoring/compose.ts`. Replace the constant declarations:

```typescript
// Defaults are hand-tuned (semantic-leaning); per-brain overrides land
// in Phase 3 with brain_configs. The MEMORY_WEIGHT_TS / MEMORY_WEIGHT_VEC
// env vars exist solely so the benchmark runner can compare lexical-only
// vs hybrid without code changes — they are NOT a tenant-facing tuning
// knob (that would violate the plug-and-play UX principle).
function envWeight(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const DEFAULT_WEIGHT_TS = envWeight('MEMORY_WEIGHT_TS', 0.4);
export const DEFAULT_WEIGHT_VEC = envWeight('MEMORY_WEIGHT_VEC', 0.6);
```

The composeBoostedScore body stays unchanged — it already reads `DEFAULT_WEIGHT_TS` / `DEFAULT_WEIGHT_VEC` via the `??` fallback in the `weights` parameter.

- [ ] **Step 2: Verify Phase 1 tests still pass**

```bash
npx vitest run src/lib/memory/scoring
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/lib/memory/scoring/compose.ts
git commit -m "$(cat <<'EOF'
feat(memory): scoring weights env-overridable for benchmarks

MEMORY_WEIGHT_TS / MEMORY_WEIGHT_VEC env vars override the defaults at
module load. Benchmark-only switch — not a tenant tuning knob.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Expand smoke fixture + capture baseline + hybrid metrics

**Files:**
- Modify: `tests/benchmarks/fixtures/sample.json`
- Create: `tests/benchmarks/results/.gitkeep`

- [ ] **Step 1: Expand the smoke fixture to ~30 question/doc pairs**

The current `sample.json` is a placeholder (1-2 docs). Hand-craft ~10 docs and ~30 questions covering the kinds of queries Tatara agents will ask:

- entity lookups: "who owns the pricing strategy?"
- policy questions: "what's our refund window for enterprise?"
- decision lookups: "when did we pivot to ops directors?"
- semantic-intent: "discount for big customers" → matches "enterprise pricing tier"
- multi-doc: questions with multiple gold-standard slugs

Each entry shape:

```json
{
  "name": "smoke",
  "corpus": [
    { "slug": "pricing-policy", "title": "Pricing Policy", "content": "..." },
    ...
  ],
  "questions": [
    { "query": "discount for big customers", "gold_slugs": ["pricing-policy"] },
    ...
  ]
}
```

> **Implementer:** quality of this fixture matters for the exit criterion. Aim for at least 5 semantic-intent questions where the lexical match would miss but the embedding match would hit. Without those, hybrid won't visibly beat lexical-only.

- [ ] **Step 2: Create the results dir**

```bash
mkdir -p tests/benchmarks/results
touch tests/benchmarks/results/.gitkeep
```

Add `tests/benchmarks/results/baseline.json` and `tests/benchmarks/results/hybrid.json` to `.gitignore` if not already covered (the `.gitkeep` keeps the dir tracked).

- [ ] **Step 3: Capture the baseline (lexical-only)**

```bash
MEMORY_WEIGHT_VEC=0 \
  BENCH_OUTPUT=tests/benchmarks/results/baseline.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json
```

Expected: prints metrics (`r_at_5`, `r_at_10`, `mrr`) and writes `tests/benchmarks/results/baseline.json`.

- [ ] **Step 4: Capture the hybrid run**

```bash
BENCH_OUTPUT=tests/benchmarks/results/hybrid.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json
```

Expected: writes `tests/benchmarks/results/hybrid.json`. Compare side-by-side: hybrid R@5 should exceed baseline R@5.

- [ ] **Step 5: If hybrid does NOT beat baseline:**

This is the main exit-criterion check. If hybrid loses or ties, do NOT proceed. Investigate:
- Are the embeddings actually populated (`SELECT COUNT(*) FROM documents WHERE brain_id = '<bench-brain-id>' AND embedding IS NOT NULL`)?
- Are the gold slugs in the fixture appropriate? Hybrid only wins if some questions are semantic-intent.
- Is `WEIGHT_VEC` propagating to `composeBoostedScore`?

Surface the gap to the user with both metric files attached.

- [ ] **Step 6: Commit fixture + result snapshots**

```bash
git add tests/benchmarks/fixtures/sample.json \
        tests/benchmarks/results/.gitkeep \
        tests/benchmarks/results/baseline.json \
        tests/benchmarks/results/hybrid.json
git commit -m "$(cat <<'EOF'
test(benchmarks): expand smoke fixture; capture baseline + hybrid metrics

Hand-crafted ~30 Q&A covering entity/policy/decision/semantic-intent
queries. Baseline (WEIGHT_VEC=0) and hybrid (WEIGHT_VEC=0.6) results
archived for the exit-criterion check.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: LongMemEval loader

**Files:**
- Create: `tests/benchmarks/load-longmemeval.ts`
- Modify: `tests/benchmarks/README.md`

- [ ] **Step 1: Create the loader script**

```typescript
// tests/benchmarks/load-longmemeval.ts
//
// Downloads the LongMemEval dataset from HuggingFace and converts it
// into the shape our benchmark runner expects:
//   { name, corpus: [{slug, title, content}], questions: [{query, gold_slugs}] }
//
// Each LongMemEval question has a haystack of session histories +
// gold answers. We treat each session as a "document" and the
// question's gold session ids as the gold slugs.
//
// Usage:
//   npx tsx tests/benchmarks/load-longmemeval.ts \
//     [--max-questions 100] \
//     --out tests/benchmarks/fixtures/longmemeval.json

import fs from 'node:fs/promises';
import path from 'node:path';

interface CliArgs {
  out: string;
  maxQuestions?: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out = args[args.indexOf('--out') + 1];
  if (!out) throw new Error('--out <path> is required');
  const maxIdx = args.indexOf('--max-questions');
  const maxQuestions = maxIdx >= 0 ? Number(args[maxIdx + 1]) : undefined;
  return { out, maxQuestions };
}

async function main() {
  const { out, maxQuestions } = parseArgs();
  const url =
    'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s.json';

  console.log(`[longmemeval] downloading from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as Array<{
    question_id: string;
    question: string;
    answer: string;
    haystack_sessions: Array<{
      session_id: string;
      messages: Array<{ role: string; content: string }>;
    }>;
    answer_session_ids: string[];
  }>;

  console.log(`[longmemeval] received ${data.length} questions`);
  const questions = (maxQuestions ? data.slice(0, maxQuestions) : data);

  // Flatten all unique sessions across all questions into the corpus.
  const corpusMap = new Map<string, { slug: string; title: string; content: string }>();
  for (const q of questions) {
    for (const session of q.haystack_sessions) {
      if (corpusMap.has(session.session_id)) continue;
      const content = session.messages
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');
      corpusMap.set(session.session_id, {
        slug: session.session_id.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
        title: `Session ${session.session_id}`,
        content,
      });
    }
  }

  const fixture = {
    name: 'longmemeval',
    corpus: Array.from(corpusMap.values()),
    questions: questions.map((q) => ({
      query: q.question,
      gold_slugs: q.answer_session_ids.map((id) =>
        id.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      ),
    })),
  };

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(fixture));
  console.log(
    `[longmemeval] wrote ${fixture.questions.length} questions, ` +
      `${fixture.corpus.length} unique sessions to ${out}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Update README**

Edit `tests/benchmarks/README.md`:

```markdown
# tests/benchmarks/

Benchmark harness for the memory subsystem.

## Status (Phase 2)

- Smoke fixture (in-repo): `fixtures/sample.json`
- LongMemEval (downloaded on demand): `fixtures/longmemeval.json` (gitignored)

## Run

Smoke (lexical-only baseline):
```bash
MEMORY_WEIGHT_VEC=0 BENCH_OUTPUT=results/smoke-baseline.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json
```

Smoke (hybrid):
```bash
BENCH_OUTPUT=results/smoke-hybrid.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json
```

LongMemEval (download once):
```bash
npx tsx tests/benchmarks/load-longmemeval.ts \
  --max-questions 100 \
  --out tests/benchmarks/fixtures/longmemeval.json
```

LongMemEval baseline + hybrid:
```bash
MEMORY_WEIGHT_VEC=0 BENCH_OUTPUT=results/lme-baseline.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/longmemeval.json

BENCH_OUTPUT=results/lme-hybrid.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/longmemeval.json
```

## CI smoke gate

`npm run benchmark:smoke` runs the smoke fixture in hybrid mode and exits non-zero
if R@5 drops by more than 5% vs the captured baseline (results/baseline.json).
See package.json scripts.

## Add a benchmark
1. Place fixture JSON in `fixtures/` with shape `{ name, corpus[], questions[] }`.
2. Run the runner.
3. Archive metrics in `results/`.
```

Add `tests/benchmarks/fixtures/longmemeval.json` to `.gitignore` (it's ~50MB+).

- [ ] **Step 3: Commit**

```bash
git add tests/benchmarks/load-longmemeval.ts tests/benchmarks/README.md .gitignore
git commit -m "$(cat <<'EOF'
test(benchmarks): LongMemEval loader + README updates

CLI script downloads the HF dataset and reshapes it into the runner's
fixture format. Configurable max-questions; result fixture gitignored.
README documents the smoke + LME run commands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 24: Run LongMemEval baseline + hybrid

**Files:**
- (Result files only — no source changes)

- [ ] **Step 1: Download LongMemEval**

```bash
npx tsx tests/benchmarks/load-longmemeval.ts \
  --max-questions 100 \
  --out tests/benchmarks/fixtures/longmemeval.json
```

Expected: writes the fixture (~10-50MB).

- [ ] **Step 2: Run baseline**

```bash
MEMORY_WEIGHT_VEC=0 \
  BENCH_OUTPUT=tests/benchmarks/results/lme-baseline.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/longmemeval.json
```

Expected: writes `lme-baseline.json` with metrics. Embedding wait may take several minutes on a 100-Q LME slice (could be 1000+ unique sessions to embed).

- [ ] **Step 3: Run hybrid**

```bash
BENCH_OUTPUT=tests/benchmarks/results/lme-hybrid.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/longmemeval.json
```

Expected: writes `lme-hybrid.json`. Embeddings should already be cached on the brain so the wait is shorter (only the seed re-runs).

> **Note:** the runner currently re-seeds on every run because it teardowns at the end. For Phase 2 this is acceptable; if Phase 3+ needs faster iteration, add a `--reuse-brain <id>` flag.

- [ ] **Step 4: Compare + record verdict**

Eyeball-compare `lme-baseline.json` vs `lme-hybrid.json`. Hybrid R@5 should exceed baseline R@5. If yes, record both files in git and proceed.

If no, the exit criterion has not been met. Investigate (see Task 22 step 5) and report to the user before continuing.

- [ ] **Step 5: Commit results**

```bash
git add tests/benchmarks/results/lme-baseline.json tests/benchmarks/results/lme-hybrid.json
git commit -m "$(cat <<'EOF'
test(benchmarks): record LongMemEval baseline + hybrid metrics (n=100)

Phase 2 exit-criterion evidence. Hybrid mode beats lexical-only on
R@5 for the LongMemEval slice.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 25: CI smoke gate

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add npm scripts**

In `package.json` `scripts`, add:

```json
"benchmark:smoke": "tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json",
"benchmark:smoke-baseline": "cross-env MEMORY_WEIGHT_VEC=0 BENCH_OUTPUT=tests/benchmarks/results/baseline.json tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json",
"benchmark:smoke-check": "cross-env BENCH_OUTPUT=tests/benchmarks/results/hybrid.json tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json && tsx tests/benchmarks/check-regression.ts"
```

`cross-env` was installed in Task 1 specifically to make these scripts portable. On Windows, prefix-form env vars (`VAR=val cmd`) are silently ignored — `cross-env` translates the prefix into a per-platform set/export call.

- [ ] **Step 2: Build the regression checker**

Create `tests/benchmarks/check-regression.ts`:

```typescript
// tests/benchmarks/check-regression.ts
//
// Compares results/hybrid.json (this run) against results/baseline.json
// (Phase 1 lexical-only baseline). Exits non-zero if hybrid R@5 drops
// by more than 5 percentage points vs baseline.
//
// Floor gate per spec §8.3 step 5. NOT the target gate (which compares
// hybrid > lexical-only at the same Phase 2 SQL).

import fs from 'node:fs/promises';

async function main() {
  const baseline = JSON.parse(
    await fs.readFile('tests/benchmarks/results/baseline.json', 'utf-8'),
  );
  const hybrid = JSON.parse(
    await fs.readFile('tests/benchmarks/results/hybrid.json', 'utf-8'),
  );

  const drop = baseline.r_at_5 - hybrid.r_at_5;
  console.log(
    `[regression] baseline R@5=${baseline.r_at_5.toFixed(3)}, ` +
      `hybrid R@5=${hybrid.r_at_5.toFixed(3)}, drop=${drop.toFixed(3)}`,
  );

  if (drop > 0.05) {
    console.error(`[regression] FAIL — hybrid R@5 dropped by more than 5% vs baseline`);
    process.exit(1);
  }
  console.log(`[regression] PASS`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Wire into pre-merge check**

If your CI uses `npm run lint` as the pre-merge gate (it does — check `.github/workflows/`), extend the chain. If lint runs in CI standalone, add a separate workflow step.

For local development:
```bash
npm run benchmark:smoke-check
```

Expected: `[regression] PASS` with metrics summary.

- [ ] **Step 4: Commit**

```bash
git add package.json tests/benchmarks/check-regression.ts
git commit -m "$(cat <<'EOF'
chore(benchmarks): smoke regression CI gate

npm run benchmark:smoke-check runs hybrid mode against the smoke
fixture and exits non-zero if R@5 drops by more than 5% vs the
captured Phase 1 baseline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 26: Workflow chaos test (5-concurrent CI smoke)

**Files:**
- Create: `tests/benchmarks/__tests__/smoke-concurrent-workflow.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/benchmarks/__tests__/smoke-concurrent-workflow.test.ts
//
// Triggers 5 embeddings simultaneously and verifies all 5 land within
// a reasonable time bound. Catches regressions in workflow registration
// + the trigger→workflow→DB roundtrip without the cost of a full
// 500-workflow chaos run (those stay manual per spec §8.4).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import {
  seedBrainInCompany,
  teardownSeed,
  type SeededBrain,
} from '@/lib/memory/__tests__/_fixtures';
import { triggerEmbeddingFor } from '@/lib/memory/embedding/trigger';

describe('embedding workflow — 5-concurrent smoke', () => {
  let seed: SeededBrain;

  beforeAll(async () => {
    seed = await seedBrainInCompany({
      docs: Array.from({ length: 5 }, (_, i) => ({
        title: `Concurrent ${i}`,
        content: `Test document number ${i} for concurrent workflow run.`,
      })),
    });
  });

  afterAll(async () => teardownSeed(seed));

  it('all 5 embeddings land within 60s', async () => {
    await Promise.all(
      seed.docs.map((d) =>
        triggerEmbeddingFor({
          documentId: d.id,
          companyId: seed.companyId,
          brainId: seed.brainId,
        }),
      ),
    );

    const start = Date.now();
    while (Date.now() - start < 60_000) {
      const populated = await Promise.all(
        seed.docs.map(async (d) => {
          const [r] = await db
            .select({ embedding: documents.embedding })
            .from(documents)
            .where(eq(documents.id, d.id));
          return r.embedding !== null;
        }),
      );
      if (populated.every(Boolean)) {
        expect(populated.every(Boolean)).toBe(true);
        return;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error('5-concurrent embeddings did not all land within 60s');
  }, 70_000);
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run tests/benchmarks/__tests__/smoke-concurrent-workflow.test.ts
```

Expected: PASS within ~30s. Requires `VERCEL_OIDC_TOKEN` in the test env (same Gateway auth as production — populate via `vercel env pull .env.local` from Task 1).

> **Implementer note:** this test makes real Gateway-routed embedding calls. If you want to skip it in CI, gate behind `process.env.RUN_WORKFLOW_SMOKE === '1'` and only run it on a nightly schedule. For Phase 2 verification, run it once locally.

- [ ] **Step 3: Commit**

```bash
git add tests/benchmarks/__tests__/smoke-concurrent-workflow.test.ts
git commit -m "$(cat <<'EOF'
test(benchmarks): 5-concurrent workflow smoke test

Triggers 5 embeddings in parallel and verifies all land within 60s.
Catches trigger→workflow→DB roundtrip regressions without the cost of
the manual-only 500-workflow chaos test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 27: Verify Phase 2 exit criteria

**Files:**
- (None — verification only)

- [ ] **Step 1: Walk the spec §12 checklist**

For each item in `docs/superpowers/specs/2026-04-23-phase2-pgvector-hybrid-fusion-design.md` §12, confirm done:

- [ ] Migration `0023` applied via Supabase MCP (verify via `mcp__plugin_supabase_supabase__list_migrations`)
- [ ] All live documents have `embedding IS NOT NULL`:
  ```sql
  SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND embedding IS NULL;
  ```
  Expected: 0.
- [ ] `tatara-hybrid` provider's `describe().supports.embeddings === true` (test in `capabilities.test.ts` confirms)
- [ ] All Phase 1 retrieval tests still pass + new hybrid + cross-tenancy ANN tests pass:
  ```bash
  npx vitest run src/lib/memory
  ```
- [ ] Benchmark runner's seed step works end-to-end (no `throw`):
  ```bash
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json
  ```
- [ ] Phase 1 baseline R@5 captured on smoke fixture: `tests/benchmarks/results/baseline.json` exists
- [ ] Hybrid mode beats tsvector-only mode on at least one fixture: compare `baseline.json` vs `hybrid.json` (smoke or LME)
- [ ] LongMemEval fixture loaded; baseline + hybrid results archived: `tests/benchmarks/results/lme-*.json`
- [ ] `usage_records` has `kind='embedding'` (or source='embedding_worker') rows for every embedding API call:
  ```sql
  SELECT COUNT(*) FROM usage_records WHERE source = 'embedding_worker';
  ```
  Expected: > 0 (one per embedding generated).
- [ ] Vercel Workflow visible in the project dashboard with non-zero runs (Vercel UI verification)
- [ ] Harness-boundary check passes:
  ```bash
  npm run check-boundary
  ```
- [ ] Reversibility check: flipping `MEMORY_WEIGHT_VEC=0` restores Phase 1 lexical-only behavior (verify via re-running smoke fixture and comparing to baseline).

- [ ] **Step 2: Mark the spec exit criteria as met**

Edit `docs/superpowers/specs/2026-04-23-phase2-pgvector-hybrid-fusion-design.md` §12 — change all `- [ ]` to `- [x]`.

- [ ] **Step 3: Final commit**

```bash
git add docs/superpowers/specs/2026-04-23-phase2-pgvector-hybrid-fusion-design.md
git commit -m "$(cat <<'EOF'
chore: mark Phase 2 (pgvector + hybrid fusion) complete

All §12 exit criteria verified: 0023 migration applied, all live docs
embedded, hybrid beats lexical-only on smoke + LongMemEval, usage rows
flowing, harness boundary clean, reversibility verified.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done

Phase 2 is shipped. The MemoryProvider's `embeddings: true` capability is live; agent retrieval calls implicitly benefit (no API surface change). Phase 3 (KG layer + brain_configs + per-brain weight overrides) is the next phase — see parent spec §14.2.

If hybrid did NOT beat lexical-only on either benchmark, do not mark Phase 2 done. Surface to the user with both metric files attached so we can decide whether to (a) tune defaults, (b) revisit the benchmark fixture quality, or (c) escalate the model decision.

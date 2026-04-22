# Agent Memory Architecture — Design

**Date:** 2026-04-22
**Status:** Design complete, pending spec review
**Scope:** Retrieval, knowledge-graph, write pipeline, research subagent, and Maintenance Agent — the "brain" substrate that agents in the Tatara harness consume. Five-phase rollout, each phase independently shippable and reversible.
**Related docs:**
- `docs/superpowers/research/2026-04-21-mempalace-memory-research.md` — MemPalace transferable ideas
- `docs/agent-context-exploration.md` — graphify transferable ideas
- `docs/superpowers/specs/2026-04-19-subagent-harness-pilot-design.md` — existing subagent infrastructure (BrainExplore v1)
- `AGENTS.md` — harness boundary rules (harness-pure constraint)

---

## 1. Problem

Tatara's agents need to traverse potentially vast, fast-growing document corpora to answer queries and execute tasks accurately. Three constraints bite simultaneously:

1. **Context-window cost of first-touch orientation.** Each tool call consumes tokens. Current retrieval (`search_documents` via tsvector FTS) returns 100–200 tokens per hit × 10 hits ≈ 1.5–2k tokens just to decide what's worth reading, then a follow-up `get_document` costs another 500–3000 tokens. Enterprise-scale corpora make this exploration path unaffordable.

2. **Fact-based accuracy.** Business agents need to answer "who owns X as of today?" or "what's our current refund policy for enterprise?" — questions that require specific, temporally-valid facts rather than prose retrieval. Reading 5 documents to synthesize an answer is slow, expensive, and a hallucination risk.

3. **Hallucination risk at business scale.** Mid-market and corporate customers explicitly need agents whose outputs are grounded and cite-able. LLM-inferred relationships ("customer X probably gets the refund policy because both docs mention enterprise") shipped to a customer-facing agent is a liability event, not a feature.

Current baseline: Postgres tsvector FTS with wikilink-derived graph, no embeddings, no knowledge graph, no compact-index layer, no temporal fact store. Multi-tenant via RLS + predicate-level `company_id` filtering.

This spec designs a layered memory substrate that solves all three constraints at enterprise scale while preserving Tatara's markdown-first principle and harness-pure boundary.

## 2. Goals

- **Retrieval API with provenance-by-contract.** Every result carries `{ path, version, confidenceTier }`. Agents cite from the retrieval shape; they don't fabricate provenance.
- **Tier-gated content.** A hard boundary between `authored`/`extracted` content (surfaced to customer-facing agents) and `inferred` content (available only to a research subagent whose output is re-grounded prose). The boundary is enforced inside the retrieval core — not via agent prompts or post-filters.
- **Structured fact retrieval.** A `kg_triples` table with temporal validity answers entity/predicate lookups in sub-100 tokens.
- **Entities as documents.** Per the markdown-first principle, entities are `type: entity` documents. No `kg_entities` table.
- **Bounded write-path cost.** LLM extraction runs as a scheduled Maintenance Agent on user-controlled cadence, not on every document save. Write-path is rule-based and agent-frontmatter-driven.
- **Memory-agnostic interface.** Extracted at end of Phase 1 once we know the real shape. Our implementation becomes one of many candidate providers (future: Letta, LightRAG, etc.).
- **Benchmark-ready.** The retrieval core is a pure function; callable from test harnesses and external benchmarks (LongMemEval, RAGAS, HotpotQA) without HTTP/auth coupling.
- **Multi-tenant from day 1.** Every table and every retrieval path enforces `company_id` + `brain_id` scoping via RLS plus predicate-level filters.

## 3. Non-goals

- **No LLM extraction on every document save.** Write path is rule-based only; LLM extraction is the Maintenance Agent's job on a schedule.
- **No inferred-tier content exposed to customer-facing agents.** The research subagent consumes inferred content internally and outputs prose strings with citations. Parent agents never see raw inferred triples.
- **No cross-brain retrieval or fact lookup.** Each query scopes to a single brain. Cross-brain is deferred until clear demand and careful ACL design.
- **No human review/approval workflow for agent-written docs.** Orthogonal concern.
- **No semantic chunking before embedding in Phase 2.** Whole-document embeddings initially. Chunking revisited as Phase 2.5 only if recall shows a gap.
- **No `kg_entities` table.** Entities are `type: entity` documents; `kg_triples.subject_slug` references them as text, not FKs, to permit dangling references as a data-quality signal.
- **No user-selectable providers in Phase 1–5.** Provider choice is a deployment-time decision; end-user-swappable providers are a Phase 6+ consideration.
- **No agent-diary feature in Phase 5.** Deferred until Maintenance Agent runs start materially benefiting from prior-run memory.

## 4. Constraints

Three hard architectural constraints, derived from existing project rules plus this session's decisions.

### 4.1 Harness-pure

Per `AGENTS.md`, code under `src/lib/agent/` cannot import Next.js or Vercel platform APIs. This design extends the rule to all new units below the tool-layer seam:

- **Allowed inside harness-pure units:** plain TypeScript, Drizzle/Supabase DB clients, AI SDK, MCP SDK, pure utilities.
- **Forbidden:** `NextRequest`, `NextResponse`, `cookies()`, `headers()`, `revalidatePath()`, `unstable_cache`, `@vercel/*` SDK calls, route-handler patterns.

The tool layer (`src/lib/tools/implementations/`) is the HTTP translation seam. Route handlers assemble `ToolContext` and call harness-pure functions. Everything below that is invocable from Cron handlers, Workflow DevKit durable functions, tests, and benchmark harnesses without framework coupling.

### 4.2 Tenant-scoped

Every table carries `company_id` and (where appropriate) `brain_id`. Every query filters by both at the predicate level **and** relies on RLS as a second layer. Matches Tatara's existing pattern (verified via code audit 2026-04-22).

Edge-existence leakage via graph traversal is prevented by `(company_id, brain_id)` prefix on every index — traversal queries cannot follow edges across tenants even accidentally.

### 4.3 Tier-gated

The strict/research tier boundary is enforced **inside the retrieval core**, not at the tool layer or via prompts. `retrieve()` accepts a `tierCeiling` parameter. Callers without the research role cannot pass `tierCeiling: 'inferred'` — it's a code error, not a runtime filter. Inferred content is never loaded from the DB for strict-tier calls; it cannot leak through a ranking, serialization, or tool-output bug.

## 5. Architecture

Three lanes, eight units, one memory-provider interface.

### 5.1 Three lanes

```
┌──────────────────────────────────────────────────────────────────────┐
│  STRICT TIER (customer-facing agents)                                │
│  Platform Agent, workflow agents, Sales/Support/Ops personas, MCP   │
├──────────────────────────────────────────────────────────────────────┤
│  Tools: search_documents, get_document, get_document_diff,          │
│         kg_query, kg_timeline, brain_overview                       │
│  Never sees: inferred-tier triples, raw graph traversal, community  │
│              maps.                                                   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  RESEARCH LANE (BrainExplore v2, subagent)                           │
│  Invoked by parent agents when strict-tier retrieval is insufficient│
├──────────────────────────────────────────────────────────────────────┤
│  Tools: strict-tier set + graph_traverse, kg_query_inferred,         │
│         community_map.                                               │
│  Output contract: cited prose string. Parent never receives raw.     │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  WRITE LANE (sync + scheduled)                                       │
│  Generating agents, rule-based extractor, Maintenance Agent, humans  │
├──────────────────────────────────────────────────────────────────────┤
│  All writes funnel through ingestDocument() → documents,             │
│  compact_index, kg_triples, embeddings.                              │
│  Provenance (source, tier, confidence, agent) attached at write.     │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 Eight units

1. **Retrieval core** — `src/lib/memory/core.ts`. Pure function: `retrieve({ brainId, companyId, query, tierCeiling, mode, filters?, limit?, tokenBudget? }) → RankedResult[]`. DB-only dependency. Platform-agnostic. Benchmark-callable.
2. **Document store extension** — `compact_index jsonb` column (Phase 1) + `embedding vector(1024)` (Phase 2). Existing `documents` schema untouched otherwise.
3. **KG triple store** — new `kg_triples` table. Entities remain `type: entity` documents.
4. **Write pipeline** — `src/lib/write-pipeline/ingest.ts`. Orchestrates rule-based extraction (sync), generating-agent frontmatter (sync), human-declared (sync), Maintenance Agent writes (scheduled). Idempotent. Precedence-merged.
5. **Tool layer** — `src/lib/tools/implementations/`. Thin wrappers over the retrieval core with Tatara's existing validate → scope → permission → audit pipeline. Tier ceiling set from `ToolContext.role`.
6. **Research subagent (BrainExplore v2)** — `src/lib/subagent/built-in/`. Haiku-grade, read-only, research-tier ceiling. Output is prose string with inline `[path#anchor]` citations.
7. **Maintenance Agent** — Vercel Cron handler + per-brain schedule. Diff-tails recently-changed docs, structured-output LLM extraction, writes via ingest pipeline at `extracted` tier. Cost-bounded.
8. **Overview generator** — bottom-up folder rollups stored as `type: overview` auto-generated documents.

### 5.3 MemoryProvider interface (extracted end of Phase 1)

```typescript
// src/lib/memory/types.ts — extracted from the first working implementation
interface MemoryProvider {
  retrieve(q: RetrieveQuery): Promise<RankedResult[]>;
  getDocument(slug: string, brainId: string): Promise<Doc | null>;
  factLookup(q: FactQuery): Promise<Fact[]>;          // empty if unsupported
  timelineFor(entitySlug: string): Promise<Fact[]>;    // empty if unsupported
  brainOverview(folderPath?: string): Promise<string>;
  graphTraverse(q: TraverseQuery): Promise<Subgraph>;  // research-tier only
  ingestDocument(write: DocumentWrite): Promise<IngestResult>;
  invalidateDocument(slug: string): Promise<void>;
  describe(): ProviderCapabilities;                     // feature detection
}
```

**Provider contract (non-negotiable):**
- Every returned result includes provenance.
- `tierCeiling` enforced by the provider, not the caller.
- `companyId`/`brainId` scoping enforced by the provider.
- A provider that cannot respect tenancy does not ship.

Our Phase 1–5 build becomes `providers/tatara-hybrid/`. The tool layer depends on `MemoryProvider`, not on our specific implementation. Capability detection via `describe()` lets agents gracefully degrade if a swapped-in provider doesn't support, e.g., `graphTraverse`.

## 6. Data model

### 6.1 Additions to `documents`

```sql
-- Phase 1:
ALTER TABLE documents ADD COLUMN compact_index jsonb;
CREATE INDEX ON documents USING gin ((compact_index -> 'entities'));
CREATE INDEX ON documents USING gin ((compact_index -> 'topics'));
CREATE INDEX ON documents USING gin ((compact_index -> 'flags'));

-- Phase 2:
ALTER TABLE documents ADD COLUMN embedding vector(1024);
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);
```

**`compact_index` shape** (target ~40 tokens serialized):

```json
{
  "entities": ["acme-corp", "jane-smith"],
  "topics": ["pricing", "enterprise"],
  "flags": ["POLICY", "CORE"],
  "proper_nouns": ["Acme Corp", "Jane Smith"],
  "key_sentence": "Enterprise tier starts at $50k/yr.",
  "date_hints": ["2026-04-22"],
  "authored_by": "rule_based | generating_agent | maintenance_agent | human",
  "computed_at": "2026-04-22T14:00:00Z"
}
```

Existing columns untouched. `embedding` dimension is model-dependent — chosen in Phase 2 via benchmark; 1024 accommodates Voyage `voyage-3` and most alternatives.

### 6.2 Entities as documents

No new table. Entities are `type: entity` documents with frontmatter:

```yaml
---
type: entity
title: Acme Corp
slug: acme-corp
entity_type: company              # company|person|product|concept|location|event
aliases: [Acme, ACME, "Acme, Inc."]
---
```

Folder convention: `/entities/` by default; authoritative marker is `type=entity`. When `kg_triples.subject_slug='acme-corp'` but no document exists, the triple becomes a "dangling entity" — surfaced in a nightly quality report, optionally backfilled.

### 6.3 `kg_triples`

Operational state per the markdown-first "runs + events" exception: temporal validity, confidence tiers, agent provenance. Not content.

```sql
CREATE TABLE kg_triples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brain_id uuid NOT NULL REFERENCES brains(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,

  subject_slug text NOT NULL,
  predicate text NOT NULL,
  object_slug text,
  object_literal text,
  CHECK (object_slug IS NOT NULL OR object_literal IS NOT NULL),

  valid_from timestamptz,
  valid_to timestamptz,

  confidence_tier text NOT NULL
    CHECK (confidence_tier IN ('authored', 'extracted', 'inferred')),
  confidence_score real
    CHECK (confidence_score IS NULL OR (confidence_score >= 0.0 AND confidence_score <= 1.0)),

  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  source_agent text,
  source_prompt_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES kg_triples(id)
);

-- Tenancy-first index layout
CREATE INDEX ON kg_triples (company_id, brain_id, subject_slug, valid_to);
CREATE INDEX ON kg_triples (company_id, brain_id, predicate, valid_to);
CREATE INDEX ON kg_triples (company_id, brain_id, object_slug, valid_to);
CREATE INDEX ON kg_triples (company_id, brain_id, confidence_tier, valid_to);
CREATE INDEX ON kg_triples (source_document_id);

ALTER TABLE kg_triples ENABLE ROW LEVEL SECURITY;
CREATE POLICY kg_triples_company_isolation ON kg_triples
  FOR ALL USING (company_id = get_user_company_id());
```

**Key design choices:**

- **`subject_slug`/`object_slug` as text, not FK.** Permits triples that reference not-yet-written entity docs; survives doc deletes. Dangling refs → quality-report signal, not constraint violation.
- **`valid_from`/`valid_to` both nullable.** Null from = "since beginning"; null to = "still valid."
- **Supersession via `superseded_by`**, never destructive updates. Full audit trail preserved.
- **`confidence_tier`** as CHECK-constrained enum, not lookup table. Three values; additive migration if extended.
- **`predicate`** as free text with per-brain controlled vocab enforced at write, not DB. Brains grow vocab without schema migration; drift surfaces in quality reports.

### 6.4 `brain_configs`

```sql
CREATE TABLE brain_configs (
  brain_id uuid PRIMARY KEY REFERENCES brains(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  maintenance_schedule text NOT NULL DEFAULT 'weekly',   -- manual | daily | weekly | custom_cron
  maintenance_custom_cron text,
  maintenance_budget_usd real,                           -- null = uncapped
  last_maintenance_run_at timestamptz,
  last_maintenance_cost_usd real,
  retrieval_config jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

`retrieval_config` carries per-brain tunables: provider choice, scoring weights, predicate vocab, inferred-tier extraction opt-in.

### 6.5 Overviews as documents

Auto-generated `_OVERVIEW.md` files per folder, stored as regular `documents` with `type: overview` and `metadata.auto_generated = true`. Filtered from `search_documents` results by default (via `type != 'overview'` predicate unless explicitly included). Regenerated on folder-content changes.

### 6.6 Migration sequence

```
0010  ALTER documents ADD compact_index jsonb + GIN indexes + backfill
0011  CREATE kg_triples + RLS + indexes
0012  CREATE brain_configs + RLS
0013  (Phase 2) ENABLE pgvector extension
0014  (Phase 2) ALTER documents ADD embedding vector(1024) + HNSW index
```

Each migration independently reversible.

## 7. Retrieval API & tier gate

### 7.1 Core function

```typescript
// src/lib/memory/core.ts
interface RetrieveQuery {
  brainId: string;
  companyId: string;                 // belt-and-suspenders
  query: string;
  mode: 'scan' | 'expand' | 'hybrid';
  tierCeiling: 'authored' | 'extracted' | 'inferred';
  filters?: {
    folderPath?: string;
    docTypes?: string[];
    dateRange?: { from?: Date; to?: Date };
    flags?: string[];
    confidenceMin?: number;
  };
  limit?: number;                    // default 10
  tokenBudget?: number;              // default 1500
}

interface RankedResult {
  documentId: string;
  slug: string;
  title: string;
  score: number;
  provenance: {
    brainId: string;
    path: string;
    updatedAt: string;
    version: number;
    confidenceTier: 'authored' | 'extracted';   // never 'inferred' for strict callers
  };
  snippet: {
    mode: 'compact' | 'headline' | 'full';
    text: string;                    // verbatim, never summarized
    anchor?: string;
  };
  compactIndex?: CompactIndex;       // scan/hybrid modes
  excerpt?: { before: string; match: string; after: string };  // expand/hybrid
}
```

### 7.2 Three modes

- **`scan`** — compact_index + slug + provenance, no content expansion. ~30–40 tokens/result.
- **`expand`** — compact_index + ts_headline + ±2 sentence context. ~150–200 tokens/result.
- **`hybrid`** — top-3 as `expand`, remainder as `scan`. Default.

Mode is a caller concern. Core function does not choose.

### 7.3 Tier gate (refuses-to-load, not post-filter)

The `tierCeiling` parameter governs which triples are even loaded from `kg_triples`. The `WHERE` clause is built from the ceiling:

```sql
-- tierCeiling='extracted' path
WHERE confidence_tier IN ('authored', 'extracted')

-- tierCeiling='inferred' path (research subagent only)
WHERE confidence_tier IN ('authored', 'extracted', 'inferred')
```

Graph traversal queries that would follow `inferred` edges short-circuit at the boundary. Strict-tier paths cannot accidentally leak inferred content via downstream bugs — the content never enters the result set.

### 7.4 Strict-tier tools

```typescript
search_documents(query, mode?, filters?, limit?)     → { results, totalMatched }
get_document(slug, anchor?)                           → full content + provenance
get_document_diff(slug, fromVersion, toVersion)       → unified diff
kg_query(subject?, predicate?, object?, asOf?)        → authored+extracted triples
kg_timeline(entitySlug, predicate?)                   → ordered triples
brain_overview(folderPath?)                           → cached rollup markdown
```

Every tool uses the core function with `tierCeiling: 'extracted'`.

### 7.5 Research-subagent tools (additional)

```typescript
graph_traverse(fromSlug, hops, predicateFilter?, confidenceMin?) → Subgraph
kg_query_inferred(…)                                              → all tiers
community_map(seedSlug?)                                          → precomputed Leiden
```

Available only when `ToolContext.role === 'research_subagent'`.

### 7.6 Research-subagent output contract

```typescript
invoke_research_subagent(question, options?)
  → {
      answer: string,                      // prose w/ inline [path#anchor] citations
      citedPaths: string[],
      confidence: 'high' | 'medium' | 'low',
      caveat?: string
    }
```

Parent agent receives `answer` as a string. Cannot request raw subgraph or inferred triples. Hallucination risk is contained inside subagent context.

### 7.7 Provenance contract (non-negotiable)

Every `RankedResult` carries `provenance.{brainId, path, version, confidenceTier}`. Every `Triple` carries `source_document_id + source_agent + confidence_tier + valid_from/to`. Agent system prompts include: "state facts with `[path#anchor]` citations; facts without citations are opinions, not assertions."

## 8. Write pipeline

### 8.1 Single merge point

```typescript
// src/lib/write-pipeline/ingest.ts
export async function ingestDocument(input: DocumentIngestInput): Promise<IngestResult>
```

Only path that writes to `documents.compact_index`, `kg_triples`, or `embedding`. UI saves, agent tool calls, Maintenance Agent Cron, bulk migrations all call it.

### 8.2 Precedence for conflicts

```
human (UI or explicit frontmatter)   >
  generating-agent frontmatter        >
    Maintenance Agent (extracted)     >
      rule-based (shallow baseline)
```

**Compact_index fields:** merge per-field by precedence. Higher-precedence source "wins" for that field; lower sources still fill unset fields.

**Triples:** never destructive. New assertions supersede via `superseded_by`; old rows retain `valid_to` intact. `authored` supersedes `extracted` for same `(subject, predicate, object)`. Maintenance Agent supersedes only its own prior `extracted` triples.

### 8.3 Four paths

**Path 1 — Generating-agent frontmatter (sync, at write).**

Generating agents (subagents producing docs: customer research, lead enrichment, call summary) emit structured frontmatter:

```yaml
---
title: Acme Corp Q2 Research Snapshot
type: research_snapshot
entities: [acme-corp, jane-smith]
topics: [enterprise_pricing, decision_maker_mapping]
facts:
  - { subject: acme-corp, predicate: owner, object: jane-smith, valid_from: 2026-04-22 }
---
```

`ingestDocument` parses frontmatter, writes triples at `confidence_tier='authored'` with `source_agent=<id>`. Non-conforming output falls through to Path 3.

**Path 2 — Maintenance Agent (scheduled, per-brain).**

Vercel Cron tick hourly, selects brains due for a run, diff-tails changed docs, structured-output LLM pass → `ingestDocument` at `confidence_tier='extracted'`. Cost budget enforced.

**Path 3 — Rule-based extractor (sync, always-on).**

Runs on every doc save. Fills compact_index gaps:
- `proper_nouns`: regex-extract capitalized sequences with stoplist
- `key_sentence`: first sentence with a decision word or ≥12 tokens
- `flags`: scan for `## DECISION` / `## CORE` / `## POLICY` headers and `!decision`/`!core` hints
- `date_hints`: ISO-8601 + common natural-language date matches
- `topics`: word-frequency ranking with stopword list

Target: ~5ms per doc. Zero LLM cost.

**Path 4 — Human-declared (sync, UI or MCP).**

Inline editors for frontmatter entities/topics/facts. Writes at `confidence_tier='authored'`. MCP `update_document` accepts the same shape.

### 8.4 Maintenance Agent loop

```json
// vercel.json
{ "crons": [{ "path": "/api/cron/maintenance-agent-tick", "schedule": "0 * * * *" }] }
```

Per tick:

1. Query `brain_configs` WHERE `next_run(maintenance_schedule, last_maintenance_run_at) <= now()` — `next_run` is a TS helper (not a PG function) computing the next scheduled tick from the cadence string; no DB-function migration required
2. For each due brain: claim PG advisory lock keyed by `brain_id`
3. Diff-tail docs changed since `last_maintenance_run_at`
4. Per batch (e.g., 50 docs): structured-output LLM call (AI SDK + Haiku) → parse → `ingestDocument` at `extracted` tier
5. Track cost; stop if `maintenance_budget_usd` exceeded; checkpoint for resumption
6. Update `last_maintenance_run_at`, `last_maintenance_cost_usd`
7. Release lock; emit `maintenance.run` audit event

### 8.5 Idempotency

Compact_index is computed (not accumulated) — same input → same output. Triples use uniqueness key on `(company_id, brain_id, subject_slug, predicate, object_slug, object_literal, confidence_tier, source_document_id)`; duplicate writes are no-ops. **Including `source_document_id` in the key is intentional** — the same fact asserted by two different documents produces two rows (one per source), preserving per-source provenance. Supersession is the only mutation pattern. Re-running Maintenance Agent on unchanged docs produces zero new writes.

### 8.6 Audit events

Extends existing `audit_events` table. New types: `document.ingested`, `triple.asserted`, `triple.superseded`, `maintenance.run`. Each carries `brain_id`, `company_id`, `source` (path), optional `cost_usd`, `agent_id`/`user_id`. Feeds existing dual-cost billing (`estimated_cost_usd` / `customer_cost_usd`).

## 9. Research subagent (BrainExplore v2)

Evolves existing `brainExploreAgent.ts` (gated by `TATARA_SUBAGENTS_ENABLED`) into v2.

**Invocation from parent agents:**

```typescript
invoke_research_subagent(question: string, options?: {
  brainId?: string,
  maxTurns?: number,            // default 5
  tokenBudget?: number,         // default 8000 input+output
  thorough?: boolean            // escalate to Sonnet
})
```

**Capabilities:**
- Model: Haiku default; Sonnet when `thorough: true`
- Tools: strict-tier + `graph_traverse`, `kg_query_inferred`, `community_map`
- `tierCeiling: 'inferred'` at the retrieval core
- Read-only. `ingestDocument` not in its tool list.
- Depth cap: 1. Cannot invoke itself. Parent cannot recurse within a turn.

**System prompt hard rules:**
1. Every non-trivial claim requires a `[path#anchor]` citation.
2. Inferred-tier content must be labeled: *"Based on how these documents are related, it appears that..."*
3. If answer materially relies on inferred edges, set `confidence: 'low'` and `caveat` explaining.
4. If no authoritative source exists, say so; do not synthesize.

**Output validation:** before returning to parent, each `[path#anchor]` citation is resolved against the brain. Unresolved citations get `⚠ stale citation` appended, not silently passed through.

**Cost attribution:** existing `usage_records.parent_usage_record_id` pattern. Aggregate cost surfaces on the parent session.

## 10. Maintenance Agent

Scheduled per-brain cadence (`manual | daily | weekly | custom_cron`). Haiku default, Sonnet opt-in via `retrieval_config.maintenance_quality: 'high'`.

### 10.1 Output schema (JSON-schema constrained)

```json
{
  "entities": [{ "slug": "...", "title": "...", "entity_type": "...", "aliases": ["..."] }],
  "triples": [{
    "subject_slug": "...",
    "predicate": "...",
    "object_slug": "..." | null,
    "object_literal": "..." | null,
    "valid_from": "..." | null,
    "valid_to": "..." | null,
    "confidence_score": 0.85,
    "evidence_quote": "Verbatim sentence from doc"
  }],
  "topic_suggestions": ["..."],
  "flag_suggestions": ["..."]
}
```

### 10.2 Confidence classes

- **Direct assertion in doc → `extracted` tier, score ≥ 0.8.** Written. `evidence_quote` must be a verbatim substring from the source doc (validator check).
- **Derivable but not stated → score 0.4–0.7.** **Discarded** by default. Only surfaces if `brain_configs.retrieval_config.infer_on_maintenance: true`, and then at `inferred` tier, research-subagent-only.

### 10.3 Scope guardrails

The Maintenance Agent cannot:
- Generate or edit document content (only frontmatter/indexes)
- Call external APIs
- Invoke other subagents
- Cross brain boundaries

Enforced via tool list.

### 10.4 Failure modes

- Malformed JSON → skip doc, log, emit `maintenance.doc_error` audit, continue
- Transient model error → exponential backoff (3 attempts)
- Repeated model errors → open circuit, `last_maintenance_status='circuit_open'`, UI surfaces
- Rate limit → backoff, resume next tick
- Budget exceeded → checkpoint + stop gracefully
- Repeated doc-specific failures → `maintenance_dead_letter` table for human review

### 10.5 Dangling-entity detector

Runs at end of each tick. Query `kg_triples.subject_slug` values without corresponding `type:entity` doc. Emits ranked list to `/_quality/dangling-entities.md` (auto-generated `type: quality_report`).

### 10.6 Controlled-vocab governance

`brain_configs.retrieval_config.predicates`:

```json
{
  "controlled": ["owns", "reports_to", "priced_at", "has_status"],
  "allow_extensions": true,
  "flag_drift": true
}
```

Maintenance Agent prompt includes the brain's predicate list with instruction to prefer existing predicates. New predicates allowed if `allow_extensions: true`; surfaced in drift report if `flag_drift: true`.

## 11. Testing & benchmarks

### 11.1 Three layers

**Unit tests (no DB):** rule-based extractor, compact_index merger, frontmatter parser, tier-gate enforcement, scoring boosts — each in isolation.

**Integration tests (DB, harness-pure):** end-to-end `ingestDocument` with various sources, `retrieve()` ranking, Maintenance Agent simulation, **cross-tenancy isolation** (two brains in different companies, every tool must never cross), supersession correctness.

**Benchmark tests (external datasets):**

```typescript
async function runBenchmark(benchmark: Benchmark, provider: MemoryProvider) {
  const brain = await seedBrain(benchmark.corpus);
  const scores = [];
  for (const q of benchmark.questions) {
    const results = await provider.retrieve({
      brainId: brain.id,
      companyId: BENCHMARK_COMPANY_ID,
      query: q.query,
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: 10,
    });
    scores.push(evaluateAgainstGold(results, q.gold));
  }
  return aggregateMetrics(scores);
}
```

Candidate benchmarks (selection deferred): **LongMemEval**, **HotpotQA**, **FanOutQA**, **RAGAS**, **TruthfulQA**, **HaluEval**.

### 11.2 Metrics

- **Retrieval:** R@5, R@10, MRR, provenance-path hit rate
- **Quality:** citation accuracy, faithfulness (LLM-judge in Phase 4+)
- **Cost:** avg tokens per exploration turn, avg $ per question, Maintenance $ per brain per week
- **Latency:** p50/p95/p99 per mode, kg_query, tool call end-to-end

### 11.3 Production observability

Every retrieval call emits a structured audit event: hashed query, mode, result count, score distribution, latency, cost, tier ceiling. Aggregates into materialized view per brain. UI "Brain → Insights" tab shows usage summary.

### 11.4 Per-brain golden set (opt-in)

Tenants pin QA pairs as regression tests. We re-run these across opted-in tenants before major retrieval changes roll out.

### 11.5 A/B provider testing

`brain_configs.retrieval_config.provider = 'tatara-hybrid' | 'experimental-xyz'`. **Internal-only** (set by Tatara engineers for A/B testing; not tenant-facing — end-user-selectable providers remain a Phase 6+ non-goal). 10% opt-in, quality feedback via thumb ratings, aggregate metrics drive promote-or-rollback.

### 11.6 Cadence

- **Pre-merge:** smoke benchmark (~30 LongMemEval questions), blocks merge on > 5% R@5 regression
- **Nightly:** full benchmark across standard sets, dashboard posted
- **Per-release:** diff report vs. prior
- **Ad hoc:** candidate provider evaluation

## 12. Phased rollout

Five phases, each independently valuable and reversible. Between phases: benchmark regression check, cross-tenancy isolation test, feature-flag rollout (internal → pilot tenant → GA).

### Phase 1 — Retrieval contract + compact index (2–3 weeks)

**Scope:** Migration 0010 + GIN indexes. Rule-based extractor. Retrieval core with tier ceiling + tenancy gate + three modes. `search_documents` refactored to emit `RankedResult`. Backfill existing docs. Hybrid scoring boosts. `_OVERVIEW.md` rollups as `type: overview` docs. Cross-tenancy integration test suite. Benchmark runner scaffold. **End of phase:** extract `MemoryProvider` interface; move to `providers/tatara-hybrid/`.

**Exit:** all existing agent calls work; `RankedResult` shape in production; cross-tenancy tests pass; interface extracted.

**Risk:** Low. Purely additive. Reversible.

### Phase 2 — pgvector + hybrid fusion (3–4 weeks)

**Scope:** Enable pgvector. Migrations 0013–0014. Async embedding worker (new writes + backfill). Hybrid scoring function with tunable weights in `retrieval_config`. Null-safe tsvector fallback. Embedding-model decision benchmark-driven (Voyage `voyage-3` recommended; validated). LongMemEval + RAGAS integration.

**Exit:** all docs have embeddings; hybrid beats tsvector-only on at least one benchmark; embedding worker ≥1000 docs/min.

**Risk:** Medium. Recurring cost. Reversible.

### Phase 3 — KG layer (3–4 weeks)

**Scope:** Migrations 0011–0012. Entity UI (`type: entity` docs). `kg_query` + `kg_timeline` tools (strict tier). Write pipeline v1 with frontmatter `facts:` → `authored` triples. Generating-agent prompts updated. Rule-based extractor extended (detect `type: entity` + alias triples). Dangling-entity reporter. Controlled predicate vocab UI. Cross-tenancy extended.

**Exit:** at least one pilot brain with triples from organic generating-agent output; `kg_query` sub-100-token answer; entity page renders.

**Risk:** Medium. First schema commitment. Predicate vocab is sticky.

### Phase 4 — Maintenance Agent + per-brain schedules (3–4 weeks)

**Scope:** `/api/cron/maintenance-agent-tick`. Per-brain schedule UI. Diff-tail + advisory lock + resumable runs. Structured-output LLM call. Budget enforcement + circuit breaker + dead-letter queue. Maintenance dashboard (cadence picker, last run, cost). Writes at `extracted` tier only.

**Exit:** Maintenance runs across pilot brains on all cadence modes; chaos testing of cost/circuit/DLQ; UI cost-transparency live; at least one brain has `extracted` triples alongside `authored`.

**Risk:** Medium-high. Recurring billable cost; transparency must be done right.

### Phase 5 — Research subagent v2 + inferred tier (4–5 weeks)

**Scope:** BrainExplore v2 system prompt + tool list. Citation validator. `invoke_research_subagent` tool. Graph traversal via recursive CTE (tenant-gated per hop). Precomputed community detection batch (Leiden → `documents.community_id` + cluster rollups). Optional inferred-tier writeback per brain. Benchmarks: HotpotQA / FanOutQA research-subagent vs. strict-only.

**Exit:** parent agent delegates multi-hop question → receives cited prose; validator catches stale refs; community detection completes <10 min on 100k-doc brain; A/B shows research-subagent improves quality without unacceptable cost.

**Risk:** High. Most novel. Reversible via flag.

### Cross-cutting (unnumbered)

- **Agent diary for Maintenance continuity** — deferred; land when justified by data.
- **Provider A/B framework** — formalized during Phase 5 when candidate providers exist to compare.
- **Tenant-facing tuning controls** — Phase 4.5 if demand surfaces.

### Phase-gate checklist

- Benchmark regression check vs. prior phase
- Cross-tenancy isolation suite green
- Feature-flag rollout (internal → pilot → GA)
- Cost telemetry wired for any new LLM paths
- ADR follow-up if decisions changed mid-phase

### Effort (solo, uninterrupted)

15–20 weeks end-to-end. Phase 1 delivers token-reduction wins; Phase 2 first measurable hallucination-rate improvement; Phases 3–4 the business-tier defensibility story; Phase 5 the ambition.

## 13. Open questions (deferred)

- **Embedding model choice** — Voyage `voyage-3` vs. OpenAI `text-embedding-3-small` vs. others. Phase 2, benchmark-driven.
- **Hybrid-scoring weights** — hand-tuned defaults vs. per-brain learned. Starts hand-tuned; learning deferred until we have enough rating data.
- **Community detection frequency** — nightly vs. weekly vs. on-write-threshold. Phase 5 decision.
- **Inferred-tier retention policy** — how long do inferred triples persist? Expiry rules? Phase 5.
- **External benchmark shortlist** — specific subset of LongMemEval/HotpotQA/FanOutQA/RAGAS to adopt as standard. Separate session.
- **Semantic chunking** — Phase 2.5 if whole-doc embeddings show a recall gap at scale.
- **Agent diary implementation details** — trigger cadence, schema, consumer pattern. Deferred.
- **Maintenance Agent per-brain model choice** — Haiku vs. Sonnet; tenant-configurable vs. Tatara-chosen.

## 14. Phase handoff contracts & task skeletons

This section exists so that Phase 2–5 plans can be authored from this spec without re-brainstorming. Each subsection covers one phase and contains:

- **Spec section pointers** — the parts of this spec that govern that phase
- **Inputs from prior phase** — concrete artefacts and metrics that must exist before this phase's plan can be written
- **Probable task skeleton** — bullet list of likely tasks (15–25 items, no TDD detail). The `writing-plans` skill will turn this into a fully decomposed plan.
- **Phase-specific notes** — anything decided in the brainstorming session that isn't already captured verbatim elsewhere in this spec

**How to use this section when starting a new phase:**

1. Read the prior phase's completion artefacts (commit, test output, baseline metrics).
2. Read the `Inputs from prior phase` checklist below; verify every item before proceeding.
3. Skip `superpowers:brainstorming` — invoke `superpowers:writing-plans` directly with this section as the brief.
4. The plan reviewer should still run; spec drift between phases is the most common failure mode.

### 14.1 Phase 2 — pgvector + hybrid fusion

**Spec section pointers:**
- §6.1 (embedding column DDL), §7 (retrieval API — embedding integrates into existing core), §11 (benchmark harness), §12 Phase 2 (scope, exit criteria), §13 (deferred decisions)

**Inputs from prior phase (Phase 1):**
- ✅ `compact_index` populated for 100% of live docs (verified via Phase 1 Task 28)
- ✅ `search_documents` returns provenance per result
- ✅ `MemoryProvider` interface extracted; `tatara-hybrid` provider in place
- ✅ Cross-tenancy isolation suite green
- ✅ Benchmark runner scaffold present at `tests/benchmarks/runner.ts`
- 🆕 **Phase 1 baseline metrics captured:** R@5, R@10, MRR on the smoke fixture (and on a representative tenant fixture if available). Phase 2 starts by re-running the benchmark to confirm baseline, then proves its lift against this number. *If Phase 1's plan didn't produce these metrics, Phase 2 Task 0 is "wire the seed helper into the benchmark runner and capture the baseline."*

**Probable task skeleton:**

1. Capture / re-confirm Phase 1 baseline retrieval metrics on the smoke fixture
2. Wire the benchmark runner's seed helper (currently a `throw` in Phase 1 scaffold) so benchmarks can run end-to-end
3. Enable pgvector extension on Supabase (DB config; verify via `\dx`)
4. Migration: `ALTER documents ADD embedding vector(N)` + HNSW index (N decided in Task 9)
5. Embedding worker module (harness-pure, in `src/lib/memory/embedding/`) with provider-agnostic interface
6. Embedding worker tests (mock embedder)
7. Async write-pipeline integration: write-pipeline enqueues embedding jobs (table or queue — Phase 1 does sync rule-based; embedding stays async to avoid blocking saves)
8. Admin backfill endpoint for embeddings on existing docs (paginated)
9. Embedding-model decision: benchmark Voyage `voyage-3-large`, OpenAI `text-embedding-3-small`, and one open-source baseline on the smoke fixture; pick + document
10. Hybrid scoring composer: extends Phase 1's `composeBoostedScore` with `cosine_similarity` term (`final = w_ts*ts_rank + w_vec*cosine + w_idx*compact_match + w_bonus*boosts`)
11. Default weights tuned hand-by-benchmark (no per-brain overrides yet — those land in Phase 3 with `brain_configs`)
12. `retrieve()` updated: add embedding similarity to the SQL, null-safe fallback when `embedding IS NULL`
13. Cross-tenancy isolation re-test with embeddings (vector ANN must respect company/brain scoping)
14. LongMemEval integration: download dataset, document the run command, capture R@5 vs Phase 1 baseline
15. RAGAS integration: faithfulness + answer-relevance + context-precision metrics
16. `tatara-hybrid` provider: `describe().supports.embeddings = true`
17. Verify Phase 2 exit criteria per §12 Phase 2 (all docs have embeddings, hybrid beats tsvector-only on at least one benchmark, embedding worker sustains ≥1000 docs/min)

**Phase-specific notes:**

- **Embedding dimension** is a Phase 2 decision; column size in §6.1 (`vector(1024)`) is illustrative — confirm against the chosen model. Voyage `voyage-3-large` is 1024 native; OpenAI `text-embedding-3-small` is 1536. If the chosen model is 1536, update the migration accordingly.
- **Per-brain weight overrides** are deferred to Phase 3 (when `brain_configs` ships). Phase 2 uses Tatara-set defaults only.
- **Semantic chunking** is explicitly Phase 2.5 — only invoke if Phase 2's whole-doc embedding shows a recall gap on long-form docs (>10k tokens).
- **Cost transparency for embedding generation** must be wired through `usage_records` (dual-cost). Embedding API calls are a tenant-billable line item.

### 14.2 Phase 3 — KG layer (entities + triples)

**Spec section pointers:**
- §6.2 (entities as `type:entity` documents), §6.3 (`kg_triples` schema), §6.4 (`brain_configs`), §7.4 (kg_query / kg_timeline tools), §8.3 Path 1 (generating-agent frontmatter), §10.5 (dangling-entity detector), §10.6 (predicate vocab), §12 Phase 3

**Inputs from prior phase (Phase 2):**
- ✅ pgvector + embeddings stable in production
- ✅ Hybrid scoring beats Phase 1 baseline on chosen benchmark
- ✅ Embedding worker has not breached cost budgets in pilot tenants
- ✅ Phase 2 retrieval metrics recorded as the new baseline for Phase 3 to inherit

**Probable task skeleton:**

1. Migration: `CREATE TABLE kg_triples` + RLS + scoped indexes (per §6.3)
2. Migration: `CREATE TABLE brain_configs` + RLS (per §6.4)
3. `brain_configs` CRUD endpoints + admin/tenant settings UI section
4. Entity convention: extend existing frontmatter parser to recognize `type: entity`, `entity_type`, `aliases`
5. Entity creation UI: tweak document create wizard to surface entity-specific frontmatter fields when `type=entity` is selected
6. Entity page render: list inbound triples timeline alongside the entity doc's prose
7. `kg_query` tool: subject + predicate + object filters, `as_of` timestamp, returns `authored + extracted` only
8. `kg_timeline` tool: ordered triples for one entity
9. Write-pipeline extension (`src/lib/write-pipeline/ingest.ts`): parse `facts:` frontmatter array → write triples at `authored` tier with `source_agent` from caller context
10. Triple uniqueness key enforcement at write (per §8.5 — same fact from two docs = two rows, one per source)
11. Generating-agent system prompts updated: emit `entities`, `topics`, `flags`, `facts` frontmatter contract (Path 1 of write pipeline)
12. Rule-based extractor extension: detect `type:entity` + auto-write `has_alias` triples for each declared alias
13. Predicate vocab governance UI: per-brain controlled list, `allow_extensions`, `flag_drift` settings
14. Dangling-entity detector implementation (read pass over triples vs. entity-typed docs)
15. Quality report writer: `/_quality/dangling-entities.md` as `type: quality_report` doc
16. Cross-tenancy isolation suite extended: triples + KG queries never leak across companies
17. `tatara-hybrid` provider: implement `factLookup`, `timelineFor`; update `describe()` to set `factLookup: true`, `timeline: true`
18. End-to-end pilot test on at least one brain: organic generating-agent output produces queryable triples; `kg_query` returns sub-100-token answer
19. Verify Phase 3 exit criteria per §12 Phase 3

**Phase-specific notes:**

- **`brain_configs` ships in Phase 3, not Phase 2.** Per-brain retrieval config + Maintenance settings live here; Phase 2 deferred per-brain weights to keep scope tight.
- **Predicate vocabulary is brain-scoped, free text, governed at write.** Drift surfaces in quality report; never schema-enforced.
- **Entity docs live in `/entities/` by convention** but the authoritative marker is `type=entity` frontmatter. Don't enforce the folder location in code.
- **`kg_entities` table is explicitly out of scope** per markdown-first principle (entities = documents).
- **No write-path LLM extraction in Phase 3.** Triples land via (a) generating-agent frontmatter, (b) human declaration. The Maintenance Agent (Phase 4) is the only LLM-extraction path.

### 14.3 Phase 4 — Maintenance Agent + per-brain schedules

**Spec section pointers:**
- §8.4 (Maintenance Agent loop mechanics), §10 (full Maintenance Agent design), §6.4 (`brain_configs` schedule + budget fields), §12 Phase 4

**Inputs from prior phase (Phase 3):**
- ✅ `kg_triples` populated with `authored`-tier triples from at least one pilot brain
- ✅ `brain_configs` table live (created in Phase 3)
- ✅ Predicate vocabulary functional (controlled list per brain)
- ✅ Generating agents emitting frontmatter contract correctly (verified on sample of recent generating-agent output)
- ✅ Phase 3 retrieval metrics recorded as new baseline

**Probable task skeleton:**

1. Confirm `brain_configs.maintenance_schedule` + `maintenance_budget_usd` + `last_maintenance_run_at` + `last_maintenance_cost_usd` columns are present (added in Phase 3); add if missing
2. `/api/cron/maintenance-agent-tick/route.ts` Vercel Cron handler scaffold; register hourly schedule in `vercel.json`
3. `next_run` TS helper: computes next tick from `(schedule, last_run)` cadence string
4. Tick-handler logic: query `brain_configs` WHERE `next_run(...) <= now()`
5. PG advisory lock claim per brain (skip ticks where another run is in progress)
6. Diff-tail query: docs changed since `last_maintenance_run_at`
7. Batch chunker: 50 docs per LLM call (configurable)
8. Structured-output LLM call (AI SDK + Haiku) with JSON-schema-constrained output per §10.1
9. `evidence_quote` verbatim validator: each emitted quote must be a substring of the source doc; reject row if not
10. Discard rule: `confidence_score < 0.8` → drop unless `infer_on_maintenance: true`, in which case write at `inferred` tier
11. Write-pipeline integration: Maintenance Agent calls `ingestDocument` (Phase 3 form) at `extracted` tier with `source_agent='maintenance_agent'`
12. Cost tracking via existing `usage_records` (dual-cost: estimated + customer)
13. Budget enforcement: stop run gracefully + checkpoint when `maintenance_budget_usd` exceeded
14. Circuit breaker: open after N consecutive model errors; sets `last_maintenance_status = 'circuit_open'`
15. Dead-letter queue: `maintenance_dead_letter` table for repeatedly-failing docs (or jsonb append on `brain_configs` if low-volume)
16. Maintenance dashboard UI: cadence picker (`manual | daily | weekly | custom_cron`), budget cap input, last-run summary, status badge, cost-this-month chart
17. Dangling-entity detector (from Phase 3) runs at end of each Maintenance tick, writes/updates `/_quality/dangling-entities.md`
18. Chaos test: budget cap fires correctly, circuit breaker opens, DLQ accumulates problem docs without losing them
19. Per-tenant cost transparency surface: where in the UI does the customer see "this run cost $X"? Wire it.
20. `tatara-hybrid` provider: no surface change; the Maintenance Agent calls `ingestDocument` directly (write-pipeline already routes there)
21. Verify Phase 4 exit criteria per §12 Phase 4

**Phase-specific notes:**

- **Cadence values land in `brain_configs.maintenance_schedule` as opaque strings** (`manual`, `daily`, `weekly`, or `custom_cron:<cron-expr>`). The `next_run` helper interprets them.
- **Cost transparency is non-negotiable.** Per ADR-003 (opaque Locus rates), customer sees `customer_cost_usd` only — but they must see it. Don't ship Maintenance Agent without the cost surface.
- **Inferred-tier writeback (`infer_on_maintenance: true`)** is opt-in per brain, off by default. When enabled, derivable-but-not-stated triples land at `inferred` tier — visible only to research subagent (Phase 5). Phase 4 wires the path; Phase 5 consumes.
- **Maintenance Agent is read-only on document content.** It writes triples, compact_index updates, and quality reports. It never edits prose.
- **Sonnet escalation** via `retrieval_config.maintenance_quality: 'high'` is supported but Haiku is the default. Brand the Sonnet path as a premium opt-in; cost telemetry should flag the bump.

### 14.4 Phase 5 — Research subagent v2 + inferred tier + graph traversal

**Spec section pointers:**
- §7.5 (research-subagent tools), §7.6 (output contract), §9 (full subagent design), §10.2 (inferred-tier writeback opt-in), §12 Phase 5

**Inputs from prior phase (Phase 4):**
- ✅ Maintenance Agent producing `extracted`-tier triples on cadence in pilot brains
- ✅ KG sufficiently populated for graph traversal benchmarks (target: ≥1000 triples in at least one pilot brain)
- ✅ Cost telemetry working (Phase 5 will add another LLM-cost line item via the research subagent)
- ✅ At least one brain with `infer_on_maintenance: true` to populate the `inferred` tier and exercise the gate

**Probable task skeleton:**

1. BrainExplore v2 system prompt: citation-required rule, inferred-vs-authored language enforcement, confidence classification rubric
2. `graph_traverse` tool: recursive CTE over `kg_triples`, tenant-gated at every hop (the `(company_id, brain_id)` index prefix is load-bearing here)
3. `kg_query_inferred` tool: same as `kg_query` with `tierCeiling='inferred'`
4. `community_map` tool: reads precomputed `documents.community_id` + cluster rollups
5. Leiden batch job (Cron-triggered nightly or weekly): writes `documents.community_id` + a `community_rollups` table or jsonb
6. Citation validator: post-process subagent output; every `[path#anchor]` must resolve to an actual doc/section in the brain; unresolved → append `⚠ stale citation` rather than silent pass
7. `invoke_research_subagent` tool exposed to parent agents (customer-facing roles); wraps the subagent dispatch
8. Output contract enforcement: subagent must return `{answer, citedPaths, confidence, caveat?}` — schema-validate before returning
9. `tierCeiling` plumbing: research-subagent role can request `'inferred'`; customer-facing roles cannot (the assertion from Phase 1 Task 20 already enforces this — re-verify under load)
10. Tool-list gating: `graph_traverse`, `kg_query_inferred`, `community_map` only registered when `ToolContext.role === 'research_subagent'`
11. `tatara-hybrid` provider: implement `graphTraverse`; update `describe()` (`graphTraverse: true`)
12. Cost attribution via existing `usage_records.parent_usage_record_id` pattern
13. HotpotQA integration (multi-hop reasoning benchmark)
14. FanOutQA integration (aggregation benchmark)
15. A/B benchmark: research-subagent path vs. strict-tier-only parent agent on multi-hop questions; report quality lift + cost delta
16. Inferred-tier writeback path activation (only consumes; Phase 4 produces)
17. Depth cap enforcement test: research subagent cannot invoke itself; parent cannot recurse within a single turn
18. Verify Phase 5 exit criteria per §12 Phase 5

**Phase-specific notes:**

- **Community detection is precomputed, not live.** Leiden runs as a batch job; results are read at query time. Frequency (nightly vs. weekly vs. on-write-threshold) is one of the §13 deferred decisions — pick during Phase 5 plan-writing based on actual KG churn.
- **Graph traversal must filter `(company_id, brain_id)` at every hop.** The recursive CTE template:
  ```sql
  WITH RECURSIVE walk AS (
    SELECT subject_slug, object_slug, predicate, 0 AS hop
    FROM kg_triples
    WHERE company_id = $1 AND brain_id = $2 AND subject_slug = $3
    UNION ALL
    SELECT t.subject_slug, t.object_slug, t.predicate, w.hop + 1
    FROM kg_triples t
    JOIN walk w ON t.subject_slug = w.object_slug
    WHERE t.company_id = $1 AND t.brain_id = $2 AND w.hop < $4
  )
  SELECT * FROM walk;
  ```
  The repeated `company_id = $1 AND brain_id = $2` is intentional — without it, an edge whose object happens to match a slug in a different tenant could be traversed.
- **Research subagent's output is a string.** Parent agent never receives raw triples or subgraphs. This is the load-bearing tier-isolation move; do not soften it for "convenience."
- **Citation validator runs on every subagent return.** Don't ship without it; an inferred-tier hallucination escaping into a customer-facing agent's output is exactly the failure mode this whole architecture is designed to prevent.
- **Phase 5 is the most novel piece.** Reversibility plan: a feature flag disables `invoke_research_subagent`; parent agents fall back to strict-tier tools and recall degrades gracefully.

### 14.5 Cross-cutting deferred items (no dedicated phase)

Land when justified by data, not on a calendar:

- **Agent diary for Maintenance Agent continuity** — implementation is trivial (`type: diary_entry` docs in `/_agents/{agent_name}/`). Trigger: when Maintenance Agent runs start materially benefiting from prior-run memory (e.g. >10% of extractions touch entities the prior run already reasoned about).
- **Provider A/B framework formalization** — formalize once a candidate provider (Letta, LightRAG, Cognee, etc.) exists in `providers/<name>/`. Until then, A/B is internal-only via `brain_configs.retrieval_config.provider`.
- **Tenant-facing retrieval tuning controls** — Phase 4.5 if tenants ask. Likely surface: a "retrieval profile" picker (e.g. "balanced" / "lexical-heavy" / "semantic-heavy") rather than raw weights.

### 14.6 What this section deliberately does NOT contain

- **TDD task steps.** That's `writing-plans`'s job.
- **Specific dollar costs or latency SLAs.** Those calibrate to Phase 1's actuals.
- **UI specifications.** Mostly shadcn/Geist + standard patterns; not architecturally load-bearing.
- **Specific external benchmark adoption.** §13 lists candidates; selection is a separate session.

## 15. References

- `docs/superpowers/research/2026-04-21-mempalace-memory-research.md`
- `docs/agent-context-exploration.md`
- `docs/superpowers/specs/2026-04-19-subagent-harness-pilot-design.md`
- `AGENTS.md` — harness boundary rules
- MemPalace: https://github.com/MemPalace/mempalace
- Graphify: https://github.com/safishamsi/graphify
- LongMemEval: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
- RAGAS: https://github.com/explodinggradients/ragas

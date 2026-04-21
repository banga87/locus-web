# MemPalace → Locus: Memory Architecture Research

**Status:** Research / exploration. Not a committed spec or plan.
**Date:** 2026-04-21
**Scope:** Evaluate transferable ideas from [MemPalace](https://github.com/MemPalace/mempalace) for reducing tokens and improving retrieval in Locus agents.
**Next step if pursued:** promote selected sections into dated specs under `docs/superpowers/specs/`.

---

## TL;DR

MemPalace is a local-first AI memory system built around four layered surfaces: hierarchical scope, a compact symbolic index (AAAK dialect), a temporal knowledge graph, and typed cross-hierarchy edges ("tunnels"). Its retrieval pipeline reaches **98.4% R@5 on LongMemEval held-out without any API calls** by fusing embeddings with keyword, temporal, and phrase-match boosts.

Locus today retrieves via PostgreSQL tsvector FTS, with a wikilink-derived graph and folder hierarchy. There is no compact-index layer, no temporal fact store, and no typed cross-folder edges. The biggest wins available without adopting embeddings are:

1. A generated **compact-index column** on `documents` → 3–5× token reduction on exploration turns.
2. A two-table **temporal knowledge graph** (`kg_entities`, `kg_triples`) → single-call entity lookups, Maintenance Agent writeback target.
3. **Hybrid scoring boosts** on existing tsvector (quoted phrase, proper noun, temporal proximity) → measurable recall gains with no new infra.

All of these fit Locus's harness boundary rules (no Next.js/Vercel coupling in `src/lib/agent/`).

---

## 1. What MemPalace actually is

Stripped of the palace metaphor, MemPalace is a Python library + MCP server exposing ~29–38 tools, built around:

### 1.1 Hierarchical scope
Wings (projects/people) → rooms (topics) → drawers (content). Every search defaults to scoped, not flat-corpus.

### 1.2 AAAK dialect — the compact symbolic index
A lossy, LLM-readable summary written alongside each drawer. Format:

```
Header:   FILE_NUM|PRIMARY_ENTITY|DATE|TITLE
Zettel:   ZID:ENTITIES|topic_keywords|"key_quote"|WEIGHT|EMOTIONS|FLAGS
Tunnel:   T:ZID<->ZID|label
Arc:      ARC:emotion->emotion->emotion
```

Example encoded drawer:

```
001:ALC+BOB|GraphQL_REST|"decided to use GraphQL instead"|0.85|determ+joy|DECISION
```

Flags: `ORIGIN, CORE, SENSITIVE, PIVOT, GENESIS, DECISION, TECHNICAL`.

**Why it matters:** agents scan AAAK lines (~20–30 tokens each) and only fetch raw drawer content when an index line looks relevant. The philosophy: *never summarize the source, but compress a symbolic index on top.*

### 1.3 Temporal knowledge graph
Two SQLite tables:

- **entities**: `id, name, type, properties (json), created_at`
- **triples**: `id, subject, predicate, object, valid_from, valid_to, confidence, source_closet, source_file, source_drawer_id, adapter_name, extracted_at`

Queries filter by `valid_from <= as_of AND (valid_to IS NULL OR valid_to >= as_of)`. `invalidate()` sets `valid_to` rather than deleting.

### 1.4 Tunnels
Explicit cross-wing/cross-room typed edges beyond structural hierarchy. Exposed via `create_tunnel`, `list_tunnels`, `follow_tunnels`.

### 1.5 Retrieval pipeline (Hybrid v4)

| Stage | Mechanism |
|-------|-----------|
| 1 | Embedding similarity (MiniLM default, ChromaDB) |
| 2 | Keyword overlap: `score × (1 + w·overlap)` |
| 3 | Temporal proximity: up to 40% distance reduction |
| 4 | Preference-pattern regex extraction → synthetic docs at index time |
| 5 (optional) | Haiku rerank |

**Benchmark results on LongMemEval:**

| Config | R@5 | Cost | API needed |
|---|---|---|---|
| Raw (Stage 1 only) | 96.6% | $0 | No |
| Hybrid v3 (Stages 1–4) | 99.4% | $0 | No |
| Hybrid v4 + Haiku rerank | 100% | ~$0.001 | Yes |
| Hybrid v4 held-out (clean) | 98.4% | $0 | No |

Authors note the 99.4% → 100% step is "teaching to the test."

### 1.6 Tool surface (MCP)

Read: `status, list_wings, list_rooms, get_taxonomy, get_aaak_spec, search, check_duplicate`.
CRUD: `add_drawer, get_drawer, list_drawers, update_drawer, delete_drawer`.
KG: `kg_query, kg_add, kg_invalidate, kg_timeline, kg_stats`.
Graph: `traverse, find_tunnels, graph_stats, create_tunnel, list_tunnels, delete_tunnel, follow_tunnels`.
Agent diary: `diary_write, diary_read`.
Settings: `hook_settings, memories_filed_away, reconnect`.

### 1.7 Philosophical commitments
- **Verbatim storage.** Never summarize the source.
- **Verify before speaking.** Agents query KG/search before answering.
- **Background indexing.** Filing and embedding never block conversation tokens.

---

## 2. Locus today — the current baseline

### 2.1 Retrieval
- **tsvector FTS only.** `search_documents` uses `plainto_tsquery + ts_rank + ts_headline`.
- GIN index on `documents.search_vector`, auto-maintained by trigger (migration 0002).
- No pgvector, no embeddings.
- File: `src/lib/tools/implementations/search-documents.ts:42`.

### 2.2 Schema highlights
- `documents`: `id, brain_id, slug, path, content, title, type, status, is_pinned, confidence_level, is_core, tags, related_documents, metadata (jsonb), search_vector, parent_skill_id`.
- `folders`: self-referencing `parent_id`, sibling-unique slugs.
- `session_attachments`: staged ingestion (`uploaded → extracted → committed|discarded`).
- `skill_manifests`: per-company compiled skill cache.
- `usage_records`: hierarchical via `parent_usage_record_id` (subagent cost rollup).
- `audit_events`: includes `subagent.invoked`, `maintenance`, `document_access`.

### 2.3 Graph / links
- `documents.metadata.outbound_links` holds `{target_slug, source: 'wikilink'|'markdown_link'}` arrays parsed on every save via `parseOutboundLinks()`.
- Derived graph endpoint: `GET /api/brain/[slug]/graph`.
- File: `src/lib/brain-pulse/markdown-links.ts`.

### 2.4 Agent surface
Built-in tools: `search_documents, get_document, get_document_diff, get_diff_history, create_document, update_document, load_skill, read_skill_file, web_search, web_fetch`.

Tool executor at `src/lib/tools/executor.ts:1` handles validation → scope gate → role-based permissions → execute → audit log.

### 2.5 Subagent pilot
`src/lib/subagent/built-in/brainExploreAgent.ts` — BrainExplore delegates scoped brain navigation to Haiku, enforces structured citations. Gated behind `TATARA_SUBAGENTS_ENABLED` flag. This is architecturally equivalent to MemPalace's scan-then-expand pattern, but without a compact-index layer to scan against.

### 2.6 Proto-palace features already present
- `is_pinned` → sidebar anchor.
- `is_core` → foundational doc marker.
- `confidence_level` → already on documents.
- `tags`, `related_documents` → manual cross-linking.
- `folders.parent_id` → one-level hierarchy.

### 2.7 Harness boundary
Per `AGENTS.md`, `src/lib/agent/` must stay platform-agnostic. All retrieval work below must live under `src/lib/tools/implementations/` and `src/db/schema/` — which is where the proposals land.

### 2.8 Key paths reference

| Area | Path |
|---|---|
| Documents schema | `src/db/schema/documents.ts:38` |
| tsvector trigger | `src/db/migrations/0002_tsvector_trigger.sql:13` |
| Search tool | `src/lib/tools/implementations/search-documents.ts:42` |
| Tool executor | `src/lib/tools/executor.ts:1` |
| Agent types (Phase 2 hooks) | `src/lib/agent/types.ts:20` |
| BrainExplore subagent | `src/lib/subagent/built-in/brainExploreAgent.ts` |
| Subagent pilot design | `docs/superpowers/specs/2026-04-19-subagent-harness-pilot-design.md` |
| Graph endpoint | `src/app/api/brain/[slug]/graph/route.ts:100` |
| Link parser | `src/lib/brain-pulse/markdown-links.ts` |

---

## 3. Recommendations, ranked by ROI

### Recommendation 1 — Compact symbolic index column (highest ROI)

**Problem:** `search_documents` returns `title + ts_headline + path` per hit — roughly 100–200 tokens × 10 results = 1–2k tokens just to decide what's worth reading. The agent still needs a follow-up `get_document`.

**Proposal:**
- Add `compact_index jsonb` (or `text`) to `documents`. Content: entities, 2–3 topic keywords, one key sentence truncated to ~55 chars, flags (`DECISION|CORE|PIVOT|TECHNICAL`), confidence. Target: ~30 tokens serialized.
- Populate via a deterministic extractor on write (regex/POS to start), upgrade to a background Haiku pass once proven.
- `search_documents` gains a `mode: 'scan' | 'expand'` parameter. Scan mode returns compact indexes only. Expand returns current-shape payload.
- BrainExplore subagent uses scan by default; platform agent calls expand/`get_document` on the subset that matters.

**Estimated savings:** 3–5× token reduction on exploration turns.
**Cost:** one new column, one extractor module, one tool-param change. No new Postgres extension.
**Reversible:** yes — column and mode param are additive.

### Recommendation 2 — Temporal knowledge graph (two Postgres tables)

**Problem:** facts that change (ownership, status, preferences, relationships) are buried in document prose. Answering "who owns X as of now?" requires search + fetch + read. No mechanism exists to mark a fact as stale.

**Proposal:**

```sql
CREATE TABLE kg_entities (
  id uuid PRIMARY KEY,
  brain_id uuid NOT NULL REFERENCES brains(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'unknown',
  properties jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brain_id, name, type)
);

CREATE TABLE kg_triples (
  id uuid PRIMARY KEY,
  brain_id uuid NOT NULL REFERENCES brains(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  predicate text NOT NULL,
  object_id uuid REFERENCES kg_entities(id) ON DELETE CASCADE,
  object_literal text,
  valid_from timestamptz,
  valid_to timestamptz,
  confidence real NOT NULL DEFAULT 1.0,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  source_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (object_id IS NOT NULL OR object_literal IS NOT NULL)
);

CREATE INDEX ON kg_triples (brain_id, subject_id, valid_to);
CREATE INDEX ON kg_triples (brain_id, predicate, valid_to);
CREATE INDEX ON kg_triples (brain_id, object_id, valid_to);
```

Four new tools in `src/lib/tools/implementations/`: `kg_query`, `kg_add`, `kg_invalidate`, `kg_timeline`.

**Key benefits:**
- Entity lookup is a single <100-token tool call.
- Temporal validity is explicit — facts are invalidated, not overwritten; timelines remain queryable.
- Gives the Maintenance Agent (Phase 2) a concrete writeback target: nightly extraction + invalidation pass.

**Cost:** two tables, four tools, one Drizzle schema file. No new Postgres extension.
**Reversible:** yes — tables are additive, tools are new.

### Recommendation 3 — Hybrid scoring boosts on tsvector (low effort, measurable)

~3 points of MemPalace's R@5 come from non-embedding boosts. All apply to tsvector:

- **Quoted-phrase verbatim match:** if query contains `"..."`, require exact phrase match and boost ~60%.
- **Proper-noun boost:** extract capitalized tokens from the query; boost docs containing them verbatim.
- **Temporal proximity:** if query/context has a date, decay by distance from `documents.updated_at` or a frontmatter date.
- **Folder-scope-as-first-class-param:** already supported; push it as the default for BrainExplore in the prompt.

All fuse into `ts_rank` as multiplicative coefficients. No new infrastructure.

**Cost:** edits to `search-documents.ts`; possibly a small query parser.
**Reversible:** trivially — coefficients can be tuned or disabled.

### Recommendation 4 — Typed tunnels across folders

**Proposal:**
- Extend `documents.metadata.outbound_links[].kind` with `'wikilink' | 'markdown_link' | 'tunnel' | 'reference'` plus optional `predicate` label.
- New tool `graph_traverse(from_doc, hops, predicate_filter?)` returning `{slug, title, compact_index}` — token-cheap navigation without loading content.

Pairs naturally with Recommendation 1: traversal returns compact indexes, not bodies.

**Cost:** metadata shape tweak, one new tool. No schema migration strictly required (metadata is jsonb), though a GIN on the relevant path may help at scale.
**Reversible:** yes — additive `kind` values.

### Recommendation 5 — Agent diary for Maintenance Agent continuity

MemPalace keeps a per-agent diary wing separate from user memory. For Locus's Phase 2 Maintenance Agent, map this to either:

- a reserved folder per brain (`_agent_diary/`) using existing document storage, or
- a small dedicated table `agent_diary_entries(id, brain_id, agent_type, created_at, content, tags jsonb)`.

Used for: "I reviewed X, merged Y, flagged Z for review." Without it, each maintenance run starts cold.

**Cost:** minimal — folder convention + two tools (`diary_write`, `diary_read`).
**Reversible:** yes.

---

## 4. What to NOT copy

- **Don't replace tsvector with embeddings.** MemPalace's own benchmarks show hybrid-on-FTS reaches 98.4% R@5 with no API calls. pgvector is a later optionality question, not a blocker. Compact index + hybrid boosts first; measure; then decide.
- **Don't adopt "wings/rooms/drawers" vocabulary.** Keep `folders` and `documents`. Steal mechanics, not metaphor.
- **Don't summarize source documents.** AAAK is lossy; Locus's verbatim Markdown stays ground truth. The compact-index column sits *on top* of, never replacing, the content.
- **Don't create synthetic preference documents.** MemPalace's Stage 4 regex extraction injects fake "User has mentioned X" docs into the corpus. This leaks indexer concerns into the content store and is teaching-to-the-test. Use the KG (`user prefers X` triple) instead.

---

## 5. Suggested sequencing

If any of this is pursued, a low-risk progression:

1. **Compact index column + scan/expand mode on `search_documents`.** Biggest immediate token win; no new tables; A/B-able.
2. **Hybrid scoring boosts.** Pure tsvector tuning; measurable; reversible.
3. **KG tables + four tools.** Unlocks entity-first queries and Maintenance Agent writeback.
4. **Typed tunnels + `graph_traverse` tool.** Builds on existing outbound_links.
5. **Agent diary.** Pair with Maintenance Agent Phase 2 rollout.
6. **(Later, optional) pgvector.** Only if post-hybrid retrieval still shows gaps.

Each step is independently valuable and independently reversible.

---

## 6. Token math (back-of-envelope)

**Current exploration turn:**
- `search_documents` → 10 hits × (title ~10 + headline ~150 + path ~15) ≈ 1,750 tokens
- Agent picks one → `get_document` ≈ 500–3,000 tokens
- **Total per exploration turn: ~2,250–4,750 tokens**

**With compact index + scan mode:**
- `search_documents` scan → 10 hits × 30 tokens ≈ 300 tokens
- Agent picks one → `get_document` ≈ 500–3,000 tokens
- **Total: ~800–3,300 tokens** (~2–3× reduction)

**Entity lookup ("who currently owns the Tatara rollout?"):**
- Today: search (~1,750) + fetch (~1,500) + parse + reason ≈ 3,250+ tokens
- With KG: `kg_query` → 1 triple, ~80 tokens
- **Reduction: ~40×** for this class of query.

These are rough estimates; real workloads need measurement once Recommendation 1 ships.

---

## 7. Open questions for later

- Who generates compact indexes — trigger-invoked deterministic extractor, or async Haiku job? Probably start deterministic, upgrade later.
- Is predicate language in the KG free-form or constrained to a controlled vocabulary per brain?
- Should compact index live on `documents` or in a sidecar table (`document_indexes`) to keep the hot path narrow?
- How does the Maintenance Agent decide when a triple's `valid_to` should be set? Inference confidence threshold?
- Is there a read-only "KG view" useful for the UI (entity pages, timelines)?

---

## 8. References

- MemPalace repo: https://github.com/MemPalace/mempalace
- MemPalace site: https://mempalaceofficial.com/ (note: `mempalace.tech` is flagged as scam domain)
- LongMemEval benchmark (referenced in MemPalace `benchmarks/BENCHMARKS.md`)
- Related Locus docs:
  - `docs/superpowers/specs/2026-04-19-subagent-harness-pilot-design.md`
  - `docs/superpowers/plans/2026-04-19-subagent-harness-pilot-plan.md`
  - `AGENTS.md` — harness boundary rules

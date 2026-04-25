# Tatara Maintenance Agent v1

**Date:** 2026-04-25
**Status:** v1 spec — the engineering core
**Owner:** Angus
**Companion to:** Document Standard v1, MCP Tool Surface v1, Default Topic Vocabulary v1, Inbox v1

## Context

The Maintenance Agent is the moat. It is the system that makes Tatara more than "pgvector with auth" — it ensures that documents written by external agents conform to the Document Standard, are deduplicated, and live in the right place. Without it, Tatara is a vector database; with it, Tatara is a maintained brain.

This spec defines the v1 architecture, behaviors, file layout, and integration points. It does not include the implementation plan — that is the next document, produced via the `writing-plans` flow once this spec is approved.

## Scope

**v1 Maintenance Agent runs synchronously on every write through MCP.** It is a *deterministic pipeline with embedded LLM steps*, not a tool-using agent loop. v1.5+ may introduce a richer agent-loop variant for Inbox-side review and an autonomous background loop; both are explicitly out of scope here.

**Three behaviors ship in v1**, derived from the Document Standard:

1. **Frontmatter validate + infer** — required fields per type; infer missing fields where possible
2. **Near-duplicate detection** — cosine + topic overlap against existing docs of the same type
3. **Re-classification** — does the proposed folder/type fit the content?

Behaviors deferred to v1.5+: conflict detection between canonical docs, atomic-fact extraction, backlink/cross-reference maintenance, compaction, auto-merge, promotion (signals → canonical), and the autonomous background loop.

## Architecture

### Where it sits

```
external agent
    │
    ▼
POST /api/mcp/route.ts
    │
    ▼
src/lib/mcp/tools.ts              ← propose_document, update_document, supersede_document
    │
    ▼
src/lib/mcp/handler.ts            ← handleToolCall (auth + dispatch)
    │
    ▼
src/lib/tools/implementations/    ← write-tool implementations
    │
    ▼
src/lib/maintenance/cheap-pass.ts ← THIS SPEC's entry point
    │       │
    │       ├── validate-frontmatter.ts    (deterministic)
    │       ├── infer-fields.ts            (LLM, Haiku)
    │       ├── detect-duplicates.ts       (deterministic; uses src/lib/memory/)
    │       ├── judge-classification.ts    (LLM, Haiku)
    │       └── assemble-outcome.ts        (deterministic)
    │
    ▼
outcome: { decision: 'commit' | 'pending' | 'rejected', ... }
    │
    ▼
write-tool implementation acts on outcome:
   - 'commit'   → write doc, return status: committed
   - 'pending'  → write doc with pending_review flag, create inbox_items row,
                  return status: pending + inbox_id
   - 'rejected' → no write, return status: rejected + reason
```

### Harness boundary

`src/lib/maintenance/` is a new platform-agnostic module under the same boundary rules as `src/lib/agent/`, `src/lib/memory/`, and `src/lib/connectors/`:

- No `next/*` imports
- No `next/headers`, `@vercel/functions`
- No `Request` / `Response` parameters
- No `@/lib/subagent/*` imports (one-way: subagent → maintenance, never reverse)
- The existing `scripts/check-harness-boundary.sh` should be extended to cover this directory

This preserves the ability to call `cheapPass()` from any execution surface — Next.js route today, Workflow DevKit worker tomorrow.

### LLM call boundary

The harness boundary rule says only `src/lib/agent/run.ts` may import `streamText` from the `ai` SDK. The Maintenance Agent's LLM calls are **non-streaming structured generation**, which is a different concern but should be governed by the same single-entry discipline.

**Decision:** add a sister entry point `src/lib/agent/run-structured.ts` exporting `runStructuredCall<T>(...)` — the single permitted entry for non-streaming structured LLM calls across the codebase. The Maintenance Agent uses this entry; it does not call the `ai` SDK directly. The harness boundary is extended to forbid direct `generateObject` / `generateText` imports outside `src/lib/agent/`.

This keeps the architectural promise — there is a single throat to strangle for LLM observability, model routing, and rate limiting — while distinguishing streaming (chat, agent loops) from structured (classification, inference) call sites.

## The cheap-pass pipeline

The pipeline is a **typed, sequential, short-circuit-on-rejection** chain.

### Input: `ProposedDoc`

```ts
type ProposedDoc = {
  type: DocType;          // canonical | decision | note | ...
  folder: Folder;         // /company | /customers | ...
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  topics: string[];
  confidence: 'low' | 'medium' | 'high';
  source: string;         // 'agent:<name>' — stamped from MCP auth context
  // op-specific:
  op: 'create' | 'update' | 'supersede';
  target_document_id?: string;  // required for update / supersede
};
```

### Output: `CheapPassOutcome`

```ts
type CheapPassOutcome = {
  decision: 'commit' | 'pending' | 'rejected';
  flags: CheapPassFlag[];      // accumulated from each step
  inferred_fields: Record<string, unknown>;  // fields the agent inferred (added to frontmatter on commit)
  reason?: string;             // human-readable; required when decision === 'rejected'
};

type CheapPassFlag =
  | { kind: 'missing_field'; field: string; suggested_value?: unknown }
  | { kind: 'near_duplicate'; existing_document_id: string; cosine: number; shared_topics: string[] }
  | { kind: 'reclassification'; suggested_folder?: Folder; suggested_type?: DocType; reasoning: string }
  | { kind: 'invalid'; field: string; problem: string };  // schema violation → rejection
```

### Step 1: `validateFrontmatter(doc)` — deterministic

Walk the universal + type-specific schema from the Document Standard. For each required field:

- **Present and valid** → no action
- **Missing but inferable** (type, folder, body all present; the field is in a known-inferable set: `topics`, `confidence`, `source`) → emit `{ kind: 'missing_field', field, suggested_value: undefined }` so step 2 can fill
- **Present but invalid** (e.g., `type` not in the type list, `topics` contains an out-of-vocabulary tag, `folder` not one of the seven) → emit `{ kind: 'invalid', field, problem }`. Pipeline short-circuits to `decision: 'rejected'`.

Schema check is via existing JSON Schema infrastructure (already used by the Tool Executor per `src/lib/mcp/tools.ts` comments). Topic vocabulary check is via the workspace's controlled vocabulary list.

### Step 2: `inferFields(doc, missingFlags)` — LLM (Haiku)

For each `{ kind: 'missing_field' }` flag from step 1, run a structured LLM call to suggest a value. The LLM sees:

- The doc title, body, type, folder
- The list of fields needing inference, with their constraint definitions
- The workspace's topic vocabulary

The LLM returns a structured object: `{ <field>: <inferred-value> }` for each. The pipeline updates the flag with `suggested_value`, and the inferred values land in `outcome.inferred_fields`.

**Inferable fields, v1:**
- `topics` — pick 1-5 from the controlled vocabulary based on body content
- `confidence` — heuristic: `note` defaults `low`; `canonical` defaults `high`; `decision` defaults `medium` unless explicitly ratified

Non-inferable fields (e.g., `decided_by` on a `decision`, `owner` on a `canonical`) → leave the flag unfilled, route to inbox as `kind: 'missing_field'`.

### Step 3: `detectNearDuplicates(doc)` — deterministic + uses `src/lib/memory/`

Uses the existing hybrid retrieval pipeline:

- Embed the proposed doc (existing `Embedder` interface)
- Query for top-K (default K=5) docs of the **same type** with cosine ≥ threshold (start at 0.85; tune later)
- Filter by topic overlap (require ≥1 shared topic)
- For each match, emit `{ kind: 'near_duplicate', existing_document_id, cosine, shared_topics }`

**For `op: 'update'` / `op: 'supersede'`**: skip self-match (don't flag the doc as a duplicate of itself). For supersede, suppress duplicate detection entirely against the targeted doc — that's the intent.

If any near-duplicate is flagged → outcome decision tilts `pending`.

### Step 4: `judgeClassification(doc)` — LLM (Haiku)

Triggered only when frontmatter is valid AND there are no rejection-level flags. Asks Haiku: "Given the doc body and title, does the proposed `(folder, type)` fit, or would `(suggested_folder, suggested_type)` fit better?"

The LLM returns one of:
- `'fits'` — no flag emitted
- `'better_alternative'` with reasoning + `suggested_folder` and/or `suggested_type` → emit `{ kind: 'reclassification', ... }`

If reclassification is flagged → outcome decision tilts `pending`.

**Performance escape hatch:** for v1, if cost becomes a problem, this step can be made probabilistic (run on every Nth write, or only when other signals are present). For v1 keep it on every write; latency is not a concern per the founder's call.

### Step 5: `assembleOutcome(flags)` — deterministic

| Flags present | Decision |
|---|---|
| Any `kind: 'invalid'` | `rejected` (with reason from the invalid flag) |
| Any non-fillable `missing_field`, OR any `near_duplicate`, OR any `reclassification` | `pending` |
| All `missing_field` flags filled in step 2 (via `inferred_fields`) and no other flags | `commit` |

The non-trivial detail: an `inferred_fields` value of `topics: ['brand', 'voice']` lands in the committed doc's frontmatter automatically. The agent that proposed the doc gets back `status: committed` with no inbox involvement; the inferred topics are returned in the response so the agent knows what was assumed.

For `pending` outcomes: the inbox item's `kind` is taken from the most-load-bearing flag — `near_duplicate` > `reclassification` > `missing_field`. If multiple flags fire, the inbox item lists them all in `context`, but the primary `kind` drives icon and copy.

## File layout

```
src/lib/maintenance/
  cheap-pass.ts                  // export cheapPass(doc): Promise<CheapPassOutcome>
  validate-frontmatter.ts        // step 1
  infer-fields.ts                // step 2 (uses runStructuredCall)
  detect-duplicates.ts           // step 3 (uses src/lib/memory/)
  judge-classification.ts        // step 4 (uses runStructuredCall)
  assemble-outcome.ts            // step 5
  types.ts                       // ProposedDoc, CheapPassOutcome, CheapPassFlag, ...
  prompts/
    infer-fields.ts              // prompt template + zod schema
    judge-classification.ts      // prompt template + zod schema
  __tests__/
    cheap-pass.test.ts           // integration: full pipeline with mocked LLM
    validate-frontmatter.test.ts
    detect-duplicates.test.ts    // uses fixtures from tests/benchmarks/
    assemble-outcome.test.ts
    infer-fields.test.ts         // mocks runStructuredCall
    judge-classification.test.ts // mocks runStructuredCall

src/lib/agent/
  run-structured.ts              // NEW: single entry point for non-streaming structured calls

src/lib/tools/implementations/
  propose-document.ts            // NEW: write tool, calls cheapPass, applies outcome
  update-document.ts             // NEW
  supersede-document.ts          // NEW
  archive-document.ts            // NEW

src/lib/mcp/
  tools.ts                       // EXTEND: register new write tools + extend search filters
  handler.ts                     // EXTEND: MCP_ALLOWED_TOOLS additions
```

## Integration with existing systems

### `src/lib/memory/` (hybrid retrieval)

Step 3 (`detectNearDuplicates`) reuses the existing `MemoryProvider` interface and the hybrid scoring pipeline. No new retrieval surface — just a query with stricter filters (same type, high cosine threshold, topic overlap).

The scoring weights for the duplicate query may differ from the user-facing retrieval scoring (we want lexical-and-semantic agreement here, not lexical-or-semantic recall). v1: use the existing weights and tune via benchmarks if dup detection is too noisy.

### `src/lib/agent/` (harness)

A new sister entry point — `runStructuredCall` in `src/lib/agent/run-structured.ts` — wraps `generateObject` from the `ai` SDK with the same observability, model routing, and rate-limit hooks as `runAgentTurn`. The Maintenance Agent never imports the `ai` SDK directly.

`runStructuredCall<T>` signature:
```ts
async function runStructuredCall<T>(args: {
  model: ModelHandle;          // 'haiku' | 'sonnet' | 'opus' or a router key
  system: string;
  prompt: string;
  schema: z.ZodSchema<T>;
  context?: { workspaceId: string; correlationId: string };
}): Promise<T>;
```

Implementation uses `generateObject({ model, system, prompt, schema })` from the `ai` SDK. ESLint `no-restricted-imports` is extended to forbid `generateObject`/`generateText` imports outside `src/lib/agent/`.

### `src/lib/audit/`

Every cheap-pass invocation emits a structured audit event:
```
{ event: 'maintenance.cheap_pass', workspace_id, document_id?, op, decision, flags, duration_ms, model_calls }
```

Inbox decisions emit their own audit events (already specified in the Inbox spec). The audit trail lets the Agent Director see exactly what the Maintenance Agent did across all writes.

### Existing schema work (`src/db/schema/`)

The `documents` table needs a `pending_review` boolean column added (with index). The `inbox_items` table is new (defined in the Inbox spec).

## The Maintenance Agent's identity

The Maintenance Agent's `source` value is `agent:maintenance`. The platform-agent slug `maintenance` is reserved (the codebase already has `platform-agent` slug reservation infrastructure per recent commits — extend the same mechanism).

Maintenance Agent writes to docs (e.g., when applying an inbox-approved merge) carry `source: agent:maintenance` plus an `approved_by: human:<name>` audit field — per the resolved open-question from the MCP Tool Surface spec.

## Testing strategy

| Layer | Approach |
|---|---|
| Step 1 (validate) | Pure unit tests, table-driven over the type/folder/topic matrix. Fast. |
| Step 2 (infer) | Mock `runStructuredCall`, assert prompt construction and result merging. |
| Step 3 (duplicates) | Reuse `tests/benchmarks/fixtures/` and the seedBrainWithEmbeddings fixture helper. Assert correct dups found at known cosine values. |
| Step 4 (classify) | Mock `runStructuredCall`, assert prompt + result handling. |
| Step 5 (assemble) | Pure unit tests, table-driven over flag combinations. |
| End-to-end | Integration test: synthetic ProposedDoc → cheapPass → assert outcome. Mocked LLM steps. Run as part of existing vitest suite. |
| Smoke (real LLM) | One smoke test per LLM step run only when `MAINTENANCE_SMOKE=1` env var set. Calls real Haiku; asserts response shape (not exact content). Excluded from CI default. |
| Regression (against benchmark suite) | Extend `npm run benchmark:smoke-check` to include a maintenance-cheap-pass scenario over the existing fixture. |

## Cost & performance

The founder explicitly deprioritized latency for v1. Targets are noted but not enforced:

- **Cheap pass total p95: < 1.5s** (composed of: ~0ms step 1, ~400ms step 2 if Haiku call needed, ~100ms step 3 with existing pgvector index, ~400ms step 4 Haiku, ~0ms step 5)
- **Per-write LLM cost ceiling: < $0.001** (Haiku × 2 small calls)

If both LLM calls fire on every write, a workspace doing 100 writes/day costs ~$0.10/day at v1 prices. Pricing-tier discussion applies (free tier could disable step 4 entirely).

## What v1 deliberately does NOT include

- **Conflict detection** between two `canonical` docs in the same topic — deferred to v1.5
- **Atomic fact extraction** from canonical docs into linked `fact` records — deferred to v1.5
- **Auto-merge** for high-confidence near-duplicates — deferred. v1 always routes near-dups to the inbox.
- **Backlink / cross-reference maintenance** — deferred to v1.5
- **Compaction / retrieval rewriting** — deferred to v1.5
- **Promotion** (signals → canonical when ratification signals fire) — deferred to v1.5
- **Background autonomous loop** — deferred to v2. v1 runs only on the synchronous write path.
- **Opus escalation tier** — deferred to v1.5. v1 uses Haiku for both LLM steps. Pricing-tier shape stays viable; the Opus tier just unlocks v1.5 deeper-review behaviors.
- **Inbox-side agent loop** for human review — deferred. v1 inbox decisions are pure human judgment with the cheap pass's flags as context.

## Open questions

1. **Workspace-level controlled vocabulary in step 1.** The vocabulary list lives where? Lean: `workspaces.topic_vocabulary` jsonb column, seeded with the v1 default. Read into memory per workspace at request time, cached briefly.
2. **Cosine threshold tuning.** Start at 0.85, but the existing benchmark fixture in `tests/benchmarks/` may provide a better empirical floor. Recommend a one-off benchmark run during implementation to set the v1 number.
3. **Step 4's "better alternative" calibration.** Haiku's classification judgment will be noisy. v1 risk: false positive reclassification flags clutter the inbox. Mitigation: only emit a reclassification flag when Haiku's "better" suggestion has a confidence-style structured field above a threshold. Implementation detail; flag during the writing-plans step.
4. **Behavior on `op: 'update'` for frontmatter inference.** Should infer-fields fill missing frontmatter on updates? Lean: yes for inferable fields (topics, confidence) when the agent omits them — same as create. The inferred values are echoed back to the calling agent.

## v1 acceptance criteria

The Maintenance Agent is implemented when:

- `src/lib/maintenance/` exists, is platform-agnostic per the harness boundary check, and exports `cheapPass(doc): Promise<CheapPassOutcome>`.
- `src/lib/agent/run-structured.ts` exists as the single entry for non-streaming structured LLM calls; ESLint forbids direct `generateObject`/`generateText` imports outside `src/lib/agent/`.
- The four MCP write tools (`propose_document`, `update_document`, `supersede_document`, `archive_document`) are implemented and route through `cheapPass` for the first three.
- The five-step pipeline produces correct outcomes for each documented flag combination, verified by table-driven tests.
- A real proposal of a near-duplicate doc to a seeded workspace returns `status: pending` with an `inbox_id` and the inbox item correctly references the existing doc.
- A real proposal of an unambiguously valid new doc returns `status: committed` synchronously.
- An invalid proposal (e.g., out-of-vocabulary topic, unknown type) returns `status: rejected` with a clear reason.
- Audit events are emitted for every cheap-pass invocation.
- The user (Angus) on May 4 can dump messy notes via Claude Code MCP, see correct cheap-pass outcomes (commit / pending / rejected) returned to Claude Code in real time, and see the brain reflect committed writes immediately and pending writes after Inbox approval.

## Next step

This spec, once approved, is the input to a `writing-plans` pass that produces a phased implementation plan — likely:

- Phase A: `runStructuredCall` entry point + harness-boundary extension
- Phase B: maintenance pipeline scaffold + steps 1, 3, 5 (deterministic only; no LLM)
- Phase C: steps 2 and 4 (LLM-backed)
- Phase D: write-tool implementations + MCP wiring
- Phase E: end-to-end integration with Inbox and audit
- Phase F: benchmark calibration (cosine threshold, reclassification calibration)

Each phase is independently testable and deployable.

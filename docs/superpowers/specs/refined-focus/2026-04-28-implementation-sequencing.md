# Refined-Focus Implementation Sequencing

**Date:** 2026-04-28
**Status:** Sequencing record — derived from dependency analysis of the five refined-focus design specs
**Owner:** Angus
**Companion to:** Document Standard v1, Default Topic Vocabulary v1, MCP Tool Surface v1, Maintenance Agent v1, Inbox v1

## Purpose

This document records the dependency analysis across the five refined-focus design specs and the recommended order in which to author and execute their implementation plans. It is not itself an implementation plan — each spec still needs its own `writing-plans` pass — but it fixes the sequencing so those plans don't collide.

## The five specs

1. `2026-04-25-tatara-document-standard.md` — folders, doc types, frontmatter, confidence model
2. `2026-04-25-tatara-default-topic-vocabulary.md` — 33-term controlled vocabulary + synonym map
3. `2026-04-25-tatara-mcp-tool-surface.md` — 11 MCP tools (4 existing, 7 new)
4. `2026-04-25-tatara-maintenance-agent-v1.md` — cheap-pass pipeline (the moat)
5. `2026-04-25-tatara-inbox-v1.md` — human-in-loop review surface

## Dependency graph

```
Document Standard ──┬──> Topic Vocabulary ──┐
                    │                       │
                    └─────> Maintenance ────┼──> Inbox
                            Agent           │
                            ▲               │
                            │               │
                            └── MCP Tool Surface
                                (write tools route through Maintenance)
```

### Hard vs soft dependencies

| Spec | Hard deps | Soft deps |
|---|---|---|
| Document Standard | none (foundation) | — |
| Topic Vocabulary | Document Standard (uses `topics:` field; vocabulary storage shape) | — |
| Maintenance Agent | Document Standard (step-1 schema validation); Topic Vocabulary (vocab check; step-2 inference) | — |
| MCP Tool Surface | Document Standard (tool descriptions); Topic Vocabulary (`get_taxonomy`); **write tools require Maintenance Agent** | read-only tools have no Maintenance dep |
| Inbox | Maintenance Agent (nothing to review without pending outcomes) | MCP write tools to feel real end-to-end |

The keystone is the Document Standard. Topic Vocabulary cleaves to it tightly (same DB surface, same validators, same seed flow) and is best treated as one workstream. Maintenance Agent depends on both. MCP write tools and Inbox both consume the Maintenance Agent.

## Recommended order

### Phase 1 — Foundation (Document Standard + Topic Vocabulary)

**Sequential. Do first. Do together.**

These two are tightly coupled and span the same surface area: DB schema, type definitions, seeds, validators. Splitting them would force two migrations and two seed passes against the same tables.

Ships:
- DB migrations: `pending_review` boolean column on `documents` (with index); `inbox_items` table; topic-vocabulary storage on workspaces (lean: `workspaces.topic_vocabulary` jsonb seeded at provisioning)
- TypeScript types: 7 folders, 7 doc types, universal + per-type frontmatter shapes, `low | medium | high` confidence
- Pure frontmatter validators (no DB calls — used by step 1 of cheap-pass later)
- Workspace provisioning seeds the 33-term vocabulary + synonym map
- The dependency-free MCP read/discovery tools land here too: `get_taxonomy`, `get_type_schema`, and the `search_documents` filter extensions (`type`, `folder`, `topics`, `confidence_min`, replacing `category` → `folder`). None of these touch the Maintenance Agent.

Phase 1 unblocks every subsequent phase.

### Phase 2 — Maintenance Agent core

**Sequential. The hard part.**

Follows the spec's own A–F phasing:

- A. `runStructuredCall` entry point in `src/lib/agent/run-structured.ts` + harness-boundary extension forbidding direct `generateObject`/`generateText` outside `src/lib/agent/`
- B. Pipeline scaffold + steps 1, 3, 5 (deterministic only)
- C. Steps 2 and 4 (LLM-backed, Haiku)
- D. Wire to write-tool implementations
- E. Audit + Inbox integration
- F. Benchmark calibration (cosine threshold; reclassification false-positive rate)

Until `cheapPass()` returns sensible outcomes, neither write tools nor Inbox have anything real to integrate with. This is the bottleneck phase.

### Phase 3 — Parallel: MCP write tools + Inbox

Once Phase 2 lands (or even when it stabilizes with mocked LLM steps), these two tracks proceed independently. They share only the `inbox_items` schema (in Phase 1) and the contract of cheap-pass outcomes (in Phase 2). No code-level conflicts.

**Track A — MCP write tools**
- `propose_document`, `update_document`, `supersede_document`, `archive_document`, `get_proposal_status`
- Each routes through `cheapPass` and respects its `commit | pending | rejected` outcome
- `source` is stamped from auth context, not agent input
- Updates `MCP_ALLOWED_TOOLS` in `src/lib/mcp/handler.ts`

**Track B — Inbox UI + APIs**
- 4 API endpoints: `GET /api/inbox`, `GET /api/inbox/[id]`, `POST /api/inbox/[id]/decide`, `GET /api/inbox/stats`
- `/inbox` two-pane route (list + detail) with three-button decision panel
- Decide endpoint applies / drops / modifies the proposed Maintenance Agent action and clears `pending_review`
- Nightly cron flips `pending` → `expired` past 30 days

Both tracks merge at the end-to-end acceptance check: dump notes via Claude Code MCP → cheap-pass commits or routes to Inbox → human resolves in one click → brain reflects the decision.

## Can everything run in parallel?

**No.** Phase 1 must precede everything (every other spec types-checks against its outputs), and Phase 2 must precede Phase 3 (write tools and Inbox both consume cheap-pass outcomes).

After Phase 2, the work forks cleanly into two parallel tracks, which is where we recover wall-clock time.

## Critical-path summary

```
Phase 1 (foundation)
    │
    ▼
Phase 2 (Maintenance Agent)
    │
    ├──> Phase 3A (MCP write tools)
    └──> Phase 3B (Inbox UI + APIs)
                 │
                 ▼
            May 4 acceptance check
```

## Authoring order for the implementation plans

When running the `writing-plans` flow, produce plans in this order so each plan can reference its predecessors:

1. Document Standard + Topic Vocabulary (one combined plan, since they ship together)
2. Maintenance Agent v1 (the spec already sketches A–F phasing — formalize it)
3. MCP Tool Surface v1 (split read-only vs. write into two phases; the read-only phase rolls into Phase 1 above)
4. Inbox v1

This matches the build order and avoids forward-references in the plans themselves.

## Notes on cross-cutting concerns

- **Schema migrations are owned by Phase 1.** No later phase invents new columns on `documents` or `workspaces`. If Phase 2 or Phase 3 uncovers a missing field, that gap goes back into a Phase 1 amendment, not a side migration.
- **`runStructuredCall` is a Phase 2 deliverable, not an existing primitive.** The Maintenance Agent's plan must include adding this entry point and tightening the harness boundary in the same change set.
- **The default vocabulary is fixed at 33 terms.** Workspaces extend via admin path (out of scope for v1). Agents proposing out-of-vocabulary topics are rejected at write time. This is enforced by step 1 of cheap-pass and tested in Phase 2.
- **Inbox API contract is set in the Inbox spec.** Phase 3A's write tools must return `inbox_id` shaped to match what `GET /api/inbox/[id]` consumes — define the shape once in shared types under `src/lib/maintenance/types.ts` so both tracks agree.

## Acceptance for this sequencing

This sequencing is "right" if:

- The May 4 end-to-end demo (dump messy notes via Claude Code MCP → committed/pending statuses → Inbox resolution → retrieval reflects the resolution) works on the first integrated build.
- No phase blocks on a missing artifact from a later phase.
- Each phase is independently testable: Phase 1 has unit tests for validators and seeded vocabulary; Phase 2 has table-driven cheap-pass tests with mocked LLM; Phase 3A has integration tests against a seeded workspace; Phase 3B has API + UI tests with mocked inbox items.

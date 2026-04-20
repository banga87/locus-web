# Agent Orchestration — Brainstorm

**Date:** 2026-04-20
**Status:** Exploration / brainstorm (not a design spec yet — captured for revisit)
**Branch:** `claude/agent-orchestration-design-JSpNG`

---

## 0. Purpose

Capture an exploratory brainstorm on how to blend Locus's existing agent primitives into a cohesive feature set for **creating teams of agents that automate work**. Three modes of operation sit in tension today, and we want to understand the unifying abstraction before committing to a shape:

1. **Highly autonomous** ("paperclip" style) — a top-level agent (e.g. a "CEO") that hires subagents autonomously to complete open-ended work.
2. **Deterministic / workflow-driven** — markdown workflow documents (essentially skill documents with a run contract) that can be triggered manually today and scheduled (cron) later.
3. **Semi-deterministic with programmatic stops** — non-deterministic agents that can go do work, but with hook-based checkpoints, human approvals, and structured hand-offs between sessions (think n8n, but the nodes are AI steps).

The question: what feature set makes all three feel like one product rather than three bolted-together features?

---

## 1. Inventory — we already have most of the primitives

Mapping what exists in the codebase today onto the three modes:

| Mode | Existing primitive | Location |
|---|---|---|
| Deterministic workflow | `runWorkflow()` + markdown body + stamping middleware | `src/lib/workflow/run.ts`, `src/lib/frontmatter/schemas/workflow.ts` |
| Chain of independent sessions | `runSubagent()` — fresh `AgentContext`, structured result back to parent, `outputContract` validation | `src/lib/subagent/runSubagent.ts`, `src/lib/subagent/types.ts` |
| Programmatic "stops" | Hook bus: `SessionStart \| PreToolUse \| PostToolUse \| Stop` with `allow / deny / inject` decisions | `src/lib/agent/hooks.ts` |
| Human checkpoints | `propose_*` tools + `<ProposalCard>` in chat | `src/lib/tools/propose-*.ts` |
| Paperclip / autonomous | `autonomous_agent` actor type reserved in `AgentActor`, not wired | `src/lib/agent/types.ts`, comment in `src/lib/agent/run.ts:6` |
| Scheduling | `schedule` field reserved on workflow frontmatter (manual-only today) | `src/lib/frontmatter/schemas/workflow.ts` |

Observations:

- The **hook bus** is the extensibility surface for all programmatic control. It already supports `allow/deny/inject`, which is the full vocabulary needed for policy gates, approvals, and context injection.
- The **subagent layer** already implements "chain of independent sessions that pass information programmatically": fresh `AgentContext`, structured result, optional `outputContract` validation.
- **Workflows** already feel like "skills with a run contract." The workflow body *is* a markdown document. This is the shape we want.
- The **proposal system** is the one in-product human-in-the-loop gate today. It's narrow (one tool call at a time) and tied to chat UX.
- **Stop hook is terminal.** There is no pausable run today — workflow cancellation only checks at `turn_start` boundaries, and the Stop hook fires once per turn with a terminal reason.

---

## 2. The unifying abstraction is latent in the schema

A **workflow markdown file** is a skill document with a run contract.
A **subagent call** is a workflow-in-miniature with a typed output.
A **"team"** in the paperclip sense is just a workflow whose steps are subagent dispatches, recursing until a leaf does real work.

So we likely don't need three UIs. We need **one "Run Graph"** concept where:

- **Nodes** = skill invocations, subagent dispatches, or MCP tool calls.
- **Edges** = structured outputs between steps (`outputContract` already does this per-step; extend to a JSON-schema contract between steps).
- **Checkpoints** = hooks attached to specific node boundaries, surfaced as proposals in chat or a run-detail UI.
- **Determinism dial** = a spectrum, not a mode switch:
  - Most deterministic: authored workflow with fixed DAG of steps.
  - Middle: authored workflow with one or more "free-form step" nodes (a subagent with broad tool access and a tight output contract).
  - Most autonomous: a top-level "CEO" agent that writes its own workflow at runtime and executes it — paperclip mode falls out of the same primitive.

The key shift: **teams are not a new object type**. A team is a workflow document whose body orchestrates subagent calls. Skill sharing, versioning, authorship, and scheduling all come for free from the workflow/skill substrate we already have.

---

## 3. Worked example — marketing creative pipeline

The example from the brainstorm: pull brand content + recent high-performing ads, spin up new creative copy in brand voice, format for Meta, submit with structured provenance.

Natural shape as a workflow with four subagent steps, each with an `outputContract`:

1. **`research` subagent** — reads brand skill documents, queries ads-account MCP for recent top performers.
   - Output: `{ brand_voice, top_performers[] }`
2. **`copywriter` subagent** — step 1's JSON is injected into context via a hook or passed as prompt prefix.
   - Output: `{ variants: [{ headline, body, cta }] }`
3. **`formatter` subagent** — converts variants into Meta ad payloads in the predesigned formats.
   - Output: `{ meta_ad_payloads[] }`
4. **`submitter` step** — plain MCP tool call to Meta.
   - **`PreToolUse` hook** fires a proposal card: "About to submit N ads to Meta — approve?" Human approves, tool executes, stamping middleware records provenance into `document.metadata`.

Every step's output is a document (or a metadata payload) with full provenance. The human only sees the proposal card at the one checkpoint that matters (the external side-effect). Everything else runs autonomously.

---

## 4. The real feature gaps

Most of the primitives exist. These are the gaps that block the vision:

### 4.1 Pausable runs (biggest unlock)

**Problem:** Stop hooks are terminal; workflow cancellation only checks at `turn_start`. There is no way to say "stop here, wait for a human decision, then resume from where you left off."

**Why it matters:** without this, proposals are only useful for single-tool approvals inside a live chat turn. For multi-step workflows with approval gates between steps, we need:

- A `paused` status on `workflow_runs` (and subagent-level analogues).
- A resume endpoint that rehydrates the run's transcript and subagent chain and continues from the next node.
- A Stop-hook decision (new variant — `pause` alongside `allow/deny/inject`) or a dedicated checkpoint hook at node boundaries.

This is what turns proposals from *"approve this one tool call"* into *"approve this node before the next one starts,"* which is the n8n mental model applied to non-deterministic agents.

### 4.2 Inter-step structured data contracts

**Problem:** `outputContract` validates a single subagent's final output, but there is no first-class notion of "step 2 reads step 1's output as typed data."

**Why it matters:** currently information flows between subagents via the parent's context accumulation, which is both lossy and non-deterministic. For n8n-style edge semantics, we want:

- A typed handoff envelope per edge (JSON Schema defined on the workflow).
- Context injection via the hook bus at `SubagentStart` (or equivalent) that splices prior-step outputs into the child's prompt deterministically.
- Possibly materialize intermediate outputs as documents so they're visible, auditable, and reusable.

### 4.3 Scheduling / trigger layer

**Problem:** `schedule` is a reserved frontmatter field; there is no executor.

**Why it matters:** cron-triggered workflows are the minimum bar for "automation" in the product sense. The executor needs to respect actor attribution (whose budget pays, whose audit log records it) and the same hook bus as interactive runs.

### 4.4 Autonomous-loop actor

**Problem:** `autonomous_agent` actor type is reserved but unwired.

**Why it matters:** paperclip / CEO mode needs a long-running execution surface (WDK, worker) and has to stay inside the harness boundary (`src/lib/agent/` must remain platform-agnostic — see `AGENTS.md`). The wiring is Phase 2 per `phase-1-mvp.md`; worth confirming the pausable-run design above plays nicely with WDK suspend/resume semantics before building either.

### 4.5 Observability — the run-graph view

**Problem:** workflow events are a flat event stream today; there's no graph view.

**Why it matters:** once runs branch into subagent trees, a flat stream becomes unreadable. We need a read-only timeline/graph visualization keyed on parent→child subagent relationships (we already record `parentUsageRecordId`, so the data is there).

---

## 5. Authoring surface — tradeoff to decide

**Option A — Visual graph editor (n8n-shaped).**
Pros: accessible to non-technical users; immediate mental model; easy to see the "shape" of a team.
Cons: second authoring surface alongside markdown; agents can't author workflows trivially (they'd need to emit graph JSON); tooling burden (node palette, layout, versioning of a graph format).

**Option B — Markdown-first with a read-only graph visualization.**
Pros: keeps "workflow = skill" ethos; the CEO agent can produce workflows the same way a human does (by writing markdown); single canonical artifact; versioning / GitHub import / frontmatter editor all work unchanged.
Cons: less immediate for non-technical users; graph shape has to be inferred from markdown structure rather than authored directly.

**Lean:** Option B. Authoring stays textual so agent-authored workflows are trivially possible. Humans get the n8n-shaped observability via the run-graph view (§4.5) without paying for a second authoring surface. Revisit if user feedback says the textual surface is a wall for non-technical users — at which point the graph editor can be a separate rendering over the same markdown artifact.

---

## 6. Open questions for revisit

1. **Pausable-run API shape.** Is pause a new hook decision (`pause`), a new hook event (`NodeBoundary`), or a new primitive outside the hook bus? How does it serialize the subagent-chain state for resume?
2. **Edge contracts.** JSON Schema per edge? Or do we lean on `outputContract` + a convention that prior-step output is injected verbatim?
3. **CEO agent scope.** Can a CEO agent author a workflow document and then immediately trigger it? That recursion is the unlock for paperclip mode — requires write access to the `documents` table via a `propose_workflow_create` tool or direct write with elevated actor capabilities.
4. **Scheduling trust model.** Cron-triggered runs imply a system actor — how does attribution, budget, and consent work when the trigger isn't a human?
5. **WDK / autonomous-loop alignment.** Confirm the pausable-run persistence model works on whichever long-running surface we pick for Phase 2 before we build it.
6. **Team metaphor in UI.** Is "team" a first-class concept in navigation (a `/teams` route) or just a filter/tag over workflows? If the unifying abstraction is "workflow," we probably don't need a separate `/teams` route — just workflow templates tagged as multi-agent.

---

## 7. Summary / TL;DR

- Locus already has the primitives for all three modes (deterministic, chain-of-sessions, autonomous). The hook bus, subagent layer, and workflow runner cover ~80% of what's needed.
- The unifying abstraction is a **Run Graph**: nodes are skills/subagents/tools, edges are typed outputs, checkpoints are hooks, and the determinism dial is how much of the graph is authored up-front vs. emitted at runtime.
- **Teams are workflows**, not a new object type. Paperclip mode is a CEO agent authoring a workflow at runtime.
- **Authoring stays markdown-first** so agents and humans use the same surface; a run-graph view gives the n8n-shaped observability on top.
- The **one biggest gap** is pausable runs — today Stop hooks are terminal. Without pause/resume, programmatic checkpoints between nodes are impossible, and the whole "semi-deterministic with stops" mode stays theoretical.

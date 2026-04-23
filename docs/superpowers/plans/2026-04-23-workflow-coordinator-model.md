# Workflow runner → platform-agent coordinator

**Date:** 2026-04-23
**Status:** In progress
**Supersedes (partially):** `2026-04-22-workflow-agent-binding.md`

## Problem

Today a workflow run is a single-model turn: the `agent:` frontmatter
field pins a model + tool allowlist + persona, and `runWorkflow` hands
the whole body to that agent. Proof point: the 2026-04-23 Linear
standup run consumed 153,396 input tokens on Haiku because the agent
inhaled every `list_issues` / `get_status_updates` response verbatim
and then summarised to 269 output tokens. The cost lands on the
wrong model and the coordination logic that would keep bulk data in
a cheap context never runs.

Pre-customer, pre-deployment: no compatibility concerns.

## Goal

Workflows run through the platform agent as coordinator. It reads the
workflow body, decides how to execute, and dispatches to subagents for
heavy lifting. User-defined `agent-definition` docs (e.g. Project
Manager) become callable subagent types — not workflow-level bindings.

Workflow execution shape after this plan:

```
[trigger] → runWorkflow
          → platform agent (Sonnet, full tool set + Agent dispatch)
          → reads workflow body
          → dispatches subagents for data fetching / bulk transforms
          → writes final output document with compact summaries
```

## Out of scope

- **Skill + workflow document-type unification** — follow-up work once
  (2) is proven. Plan tracked separately.
- **Removing `TATARA_SUBAGENTS_ENABLED` on the chat route** — only the
  workflow path hard-enables subagents here. Chat keeps its gate.
- **Subagent cancellation verification** — known edge case; follow-up.

## Pre-flight

1. Read `src/lib/workflow/run.ts` (the runner; touched heavily).
2. Read `src/app/api/agent/chat/route.ts` lines 280–360 (existing
   subagent wiring to copy from).
3. Read `src/lib/subagent/registry.ts`, `runSubagent.ts`, `types.ts`
   (dispatch layer to extend).
4. Read `src/lib/agents/resolve.ts` (being deleted).
5. The workflow-agent-binding e2e test
   (`src/__tests__/workflow-agent-binding.e2e.test.ts`) will be
   replaced — do not try to keep it green during Task 1.

## Tasks

### Task 1: Rip out workflow-level agent binding

**What:** Remove the per-workflow `agent:` field and everything that
resolves it. The field will return in a different shape once doc
unification lands; here we delete cleanly.

**Files to delete:**
- `src/lib/agents/resolve.ts` + its test
- `src/__tests__/workflow-agent-binding.e2e.test.ts` (replaced in Task 5)

**Files to edit:**
- `src/lib/brain/frontmatter.ts` — drop `agent` from
  `WorkflowFrontmatter` + validator. Drop `AGENT_SLUG_RE`.
- `src/lib/frontmatter/schemas/workflow.ts` — drop `agent` field +
  remove from `defaults()` + validate wrapper.
- `src/lib/frontmatter/__tests__/integration.round-trip.test.ts` —
  remove `agent: null` from pristine fixture.
- `src/lib/agents/wizard-schema.ts` — remove the `platform-agent`
  refine (slug is still validated as a generic slug).
- `src/components/workflows/new-workflow-form.tsx` — drop the Run-as
  `<Select>`, the SWR fetch, the `PLATFORM_AGENT_SENTINEL` constant,
  the Radix scrollIntoView polyfill comment.
- `src/lib/workflow/run.ts` — drop the `resolveAgentConfigBySlug`
  import + call, the `AgentNotFoundError` branch, `agentConfig` usage,
  the tool-allowlist filter, the `model: agentConfig?.model` override,
  the `agentDefinitionId: agentConfig?.id ?? null` line.

**Database:** none. Pre-customer; existing workflow rows in local dev
can be patched manually via Supabase MCP if they have the field
(harmless — the validator will ignore unknown keys).

**Tests:** existing preflight, system-prompt, stamp-middleware,
runWorkflow tests must stay green. The agent-binding e2e test is
deleted.

**Why first:** compacts the codebase before we layer the new model on.
Nothing in subsequent tasks should reference `agent:` frontmatter.

### Task 2: User-defined agents resolvable as subagent types

**What:** `agent-definition` documents (created via
`src/lib/agents/wizard-schema.ts`) become callable subagent types.
The `Agent` tool's enum and `runSubagent`'s registry lookup extend
beyond hard-coded built-ins.

**Design:**

- New module: `src/lib/subagent/userDefinedAgents.ts`
  - `listUserDefinedAgents(companyId): Promise<BuiltInAgentDefinition[]>`
    — query `documents` where `type='agent-definition'`, company-scoped,
    materialise each row into a `BuiltInAgentDefinition` (agentType =
    slug, whenToUse = description, model = frontmatter.model,
    tools/disallowedTools from allowlist, getSystemPrompt = () =>
    persona + capabilities block, omitBrainContext = false).
  - The materialisation is stateless — no caching in Task 2. Cache
    behind a per-turn memo later if the DB query becomes hot.

- Extend `runSubagent.ts`:
  - Accept an additional `lookupAgent(agentType)` parameter that falls
    back to `getBuiltInAgent` if the user-defined resolver returns
    null. Callers (chat route + workflow runner) wire their own
    company-scoped resolver.

- Extend `buildAgentTool.ts`:
  - Accept a `agents: BuiltInAgentDefinition[]` param (merged list,
    passed by caller). Used for description rendering AND to gate the
    Zod enum on valid subagent_types.
  - The inputSchema `subagent_type` becomes `z.enum([...agents.map(a
    => a.agentType)])` rather than `z.string()`. Catches typos at
    tool-call parse time.

**Tests:**
- Unit: `listUserDefinedAgents` returns correctly materialised
  definitions (seed one `agent-definition` doc; assert shape).
- Unit: `buildAgentTool` rejects a subagent_type not in the enum.
- Unit: `runSubagent` resolves a user-defined agent and executes.

**Why:** without this, the Project Manager agent we already built has
no runtime role once Task 1 removes the workflow-level binding.

### Task 3: Workflow runner uses platform agent + Agent dispatch

**What:** `runWorkflow` no longer resolves a custom agent config.
Platform agent (default model) is always the coordinator. The `Agent`
tool is always in the tool set for workflow runs.

**Edits to `src/lib/workflow/run.ts`:**
- Pin `model` to the platform default (`DEFAULT_MODEL` constant — see
  chat route, extract to `src/lib/agent/model.ts` if it isn't already
  shared).
- After MCP OUT load, build the merged agent list:
  `const agents = [...getBuiltInAgents(), ...await
  listUserDefinedAgents(workflowDoc.companyId)]`.
- Build the `Agent` tool with `buildAgentTool({ parentCtx:
  agentContext, getParentUsageRecordId: () => null, description:
  buildAgentToolDescription(agents), cap: { limit: 10, count: 0 } })`.
- Merge into `externalTools` before `buildToolSet` (mirrors chat
  route lines ~318–327).
- Remove the `agentConfig?.toolAllowlist` filter block. Workflows get
  everything.
- `grantedCapabilities`: keep current derivation (default all, since
  no per-agent capabilities cap).

**Tests:**
- Unit: `runWorkflow` uses default model (assert the `model` param
  passed to `runAgentTurn`).
- Unit: `Agent` tool is present in the final filtered tool set.

**Why:** this is the behavioural change. After Task 3, a workflow run
is definitionally "platform agent executes workflow body with full
tools + subagent dispatch."

### Task 4: Workflow preamble instructs coordinator behaviour

**What:** Strengthen `buildWorkflowSystemPrompt` to tell the platform
agent: "you are the coordinator; dispatch heavy tool work to
subagents."

**Edit to `src/lib/workflow/system-prompt.ts`:**
Add a paragraph near the top of the preamble:

> **You are the coordinator for this workflow.** For any step that
> requires pulling large amounts of data from external tools (MCP
> listings, bulk queries, multi-page reads), dispatch the work to a
> subagent via the `Agent` tool rather than calling the tool
> yourself. The subagent's context absorbs the raw tool output; only
> its summary returns to you. This keeps your context tight and
> reserves your reasoning for synthesis. The available subagent types
> and their strengths are described in the `Agent` tool's description.

Update the inline snapshot test.

**Tests:** snapshot refresh only.

**Why:** without this, the platform agent still defaults to calling
external tools directly on its own turn. The instruction is what turns
150k-token turns into 10k-token turns.

### Task 5: End-to-end coordinator test

**What:** Replace the deleted `workflow-agent-binding.e2e.test.ts`
with a test proving the coordinator pattern works.

**File:** `src/__tests__/workflow-coordinator.e2e.test.ts`

**Setup:**
- Seed company + user + brain + a `product` folder.
- Seed an `agent-definition` doc for a "data-fetcher" subagent with
  model = Haiku.
- Seed a workflow doc whose body is "Fetch the latest issue list and
  summarise the top three." No `agent:` field.
- Mock the platform model to produce two turns: first turn dispatches
  `Agent({ subagent_type: 'data-fetcher', ... })`, then second turn
  calls `create_document` with the summary.
- Mock the subagent model to return a short text blob ("top three:
  A, B, C").

**Assertions:**
- Parent turn's tool calls include `Agent` (correct subagent_type).
- `create_document` is called with body containing "top three".
- The output document lands in `product/`.
- Run status = completed.
- Usage attribution: both parent and subagent turns contributed
  tokens (no hard check on `workflow_run_id` yet — Task 6).

**Why:** real regression protection for the pattern. Mocking is
painful but the alternative (live-model e2e) is slow and flaky.

### Task 6 (stretch): Usage attribution for subagent calls

**What:** Add `workflow_run_id` nullable FK to `usage_records`.
Thread it through subagent dispatch so subagent costs roll up to the
run row's totals.

**Migration:** `ALTER TABLE usage_records ADD COLUMN workflow_run_id
uuid REFERENCES workflow_runs(id) ON DELETE SET NULL;`
plus an index on `(workflow_run_id)`.

**Edits:**
- `runWorkflow`: pass `workflowRunId` into the subagent dispatch path.
- `runSubagent`: when present, include on the inserted usage_records
  row.
- `recordUsage`: accept `workflowRunId`.

**Why:** observability. Without this, subagent spend on workflow runs
shows as orphan rows. Non-blocking — the runner works without it —
hence stretch.

## Cut lines

If pressed for time, Task 6 cuts entirely. Tasks 1–5 are the minimum
to ship the coordinator model.

## Rollback

Pre-customer; no rollback plan needed. If the coordinator pattern
regresses somehow, `git revert` back to the pre-Task-3 state.

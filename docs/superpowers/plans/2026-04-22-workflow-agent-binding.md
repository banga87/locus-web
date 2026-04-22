# Workflow → Agent Binding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workflow document declare which agent-definition runs it, via an optional `agent: <slug>` field in the workflow frontmatter. When absent (or set to the reserved slug `platform-agent`), workflows keep their current unrestricted behavior. When set to a user-created agent-definition, the runner applies that agent's model, tool allowlist, skill allowlist, baseline docs, system-prompt snippet, and capabilities.

**Non-goals (explicitly):**
- Multi-step `steps:` arrays.
- Step-to-step output handoff.
- Mid-run agent switching.
- A seeded `platform-agent` row per brain (the platform agent is virtual — reserved slug, no DB row).
- Changing the workflow runner's acting identity (stays `platform_agent` for audit/billing parity).

**Architecture:**
- `WorkflowFrontmatter` gains one optional field: `agent: string | null`. Slug format matches agent-definition slugs (`^[a-z0-9-]+$`). The reserved literal `platform-agent` is treated identically to absent.
- A new `resolveAgentConfigBySlug(brainId, slug)` helper in `src/lib/agents/resolve.ts` loads the agent-definition doc and returns a plain runtime-config struct (`model`, `toolAllowlist`, `skillIds`, `baselineDocIds`, `systemPromptSnippet`, `capabilities`). Returns `null` for the platform agent (reserved or absent). Throws `AgentNotFoundError` if the slug refers to a missing/deleted agent-definition.
- `runWorkflow` calls the resolver before building tools/system. When it returns non-null, the runner applies the config: filters the tool set, filters `availableSkills` in the system prompt, prepends the persona snippet, and passes the model override into `runAgentTurn`. When null, no behavior change.
- UI: `/workflows/new` and the frontmatter editor on `/workflows/[slug]` gain an optional "Run as" dropdown. Default is "Platform agent (unrestricted)". Switching agents on an existing workflow with run history is allowed without a confirmation — past runs are immutable records; the selection applies to future runs only.

**Tech Stack:** Next.js (App Router), React, Drizzle ORM on Supabase Postgres, js-yaml 4, Zod, Vitest.

**Worktree:** create a fresh worktree from the current default branch. Name: `workflow-agent-binding`. All paths below are relative to the worktree root.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/lib/agents/resolve.ts` | `resolveAgentConfigBySlug(brainId, slug)` + `AgentNotFoundError`. Pure-ish: one DB read, no HTTP, no side effects. |
| `src/lib/agents/__tests__/resolve.test.ts` | Resolver unit tests — hit, miss, soft-deleted, reserved slug, cross-tenant guard. |
| `src/lib/frontmatter/schemas/__tests__/workflow-agent.test.ts` | Schema tests for the new `agent` field (accept/reject/normalise). |

### Existing files to modify

| File | Change |
|---|---|
| `src/lib/brain/frontmatter.ts` | Add optional `agent: string \| null` to `WorkflowFrontmatter` and `validateWorkflowFrontmatter`. Slug regex check. `platform-agent` → normalise to `null`. |
| `src/lib/frontmatter/schemas/workflow.ts` | Expose `agent` in the schema registry so `FrontmatterPanel` can render a dropdown. |
| `src/lib/agents/wizard-schema.ts` | Reject slug `platform-agent` on create/update (`refine`). |
| `src/lib/workflow/run.ts` | Resolve `agent` slug before building tools/system. When resolved: filter `buildToolSet`, filter `availableSkills`, prepend `system_prompt_snippet`, pass `model`. Map `AgentNotFoundError` → `markFailed` with a clear error. |
| `src/lib/workflow/system-prompt.ts` | Accept optional `agentPersona: string \| null`. When set, insert it between base prompt and workflow preamble. |
| `src/components/workflows/new-workflow-form.tsx` | Add "Run as" dropdown populated from `GET /api/agents`. Default pre-selects platform agent. |
| `src/components/frontmatter/frontmatter-panel.tsx` | Render the `agent` field as a dropdown (driven by the schema's enum provider). |
| `src/app/(app)/workflows/page.tsx` | Optional: surface agent name per row. (Nice-to-have — can ship later.) |

### Commands reference

```bash
npx vitest run <path>         # one-shot, CI-style
npx vitest <path>             # watch mode
npm run lint                  # eslint + harness-boundary check
npx tsc --noEmit              # type-check
```

---

## Pre-flight

Before starting Task 1, verify (don't code yet — capture findings in a comment on the first PR):

- [ ] Confirm `runAgentTurn` accepts a model override. Read `src/lib/agent/run.ts` and note the exact parameter name.
- [ ] Confirm how the chat route applies `system_prompt_snippet`, `tool_allowlist`, and `baseline_docs` from an agent-definition today. Look in `src/app/api/agent/chat/route.ts` and any SessionStart / UserPromptSubmit hook handlers. If there's a shared helper, reuse it. If logic is inlined, the chat route's duplication stays out of scope — don't refactor chat in this plan.
- [ ] Confirm the frontmatter editor (`FrontmatterPanel`) supports async-populated enum options. If not, fall back to a free-text slug field for Task 6 and revisit later.
- [ ] Confirm `documents` carries a `(brainId, slug, type)` query path that's indexed. If not, the resolver query still works but add an index in a follow-up — do not block on it here.

---

## Tasks

### Task 1 — Frontmatter schema: add `agent`

**Files:** `src/lib/brain/frontmatter.ts`, `src/lib/frontmatter/schemas/workflow.ts`, `src/lib/frontmatter/schemas/__tests__/workflow-agent.test.ts`.

- [ ] Add `agent?: string | null` to `WorkflowFrontmatter`.
- [ ] Extend `validateWorkflowFrontmatter`:
  - Absent → `null`.
  - `null` → `null`.
  - `'platform-agent'` → `null` (normalise reserved literal).
  - String matching `^[a-z0-9-]+$`, 1-128 chars → keep as-is.
  - Anything else → validation error on field `agent`.
- [ ] Update `workflowSchema` in `src/lib/frontmatter/schemas/workflow.ts` to expose the new field with a display label "Run as".
- [ ] Write tests: accept absent, `null`, `'platform-agent'`, valid custom slug; reject non-string, empty string, invalid chars.

**Verification:** `npx vitest run src/lib/frontmatter/schemas/__tests__/workflow-agent.test.ts` + `src/lib/brain/__tests__/frontmatter.test.ts` (add a case there too).

### Task 2 — Reserve `platform-agent` slug on agent create/update

**Files:** `src/lib/agents/wizard-schema.ts`, existing wizard-schema test file.

- [ ] Add a `.refine(slug => slug !== 'platform-agent', ...)` to `agentWizardInputSchema.slug`.
- [ ] Test: wizard input with slug `platform-agent` fails validation with a clear message.

**Verification:** existing test file for the wizard schema.

### Task 3 — Agent-config resolver

**Files:** `src/lib/agents/resolve.ts`, `src/lib/agents/__tests__/resolve.test.ts`.

- [ ] Export `AgentNotFoundError` (subclass of `Error` with a `slug` property).
- [ ] Export `resolveAgentConfigBySlug(brainId: string, slug: string | null): Promise<AgentRuntimeConfig | null>`:
  - Input `null` or `'platform-agent'` → return `null` (platform agent).
  - Otherwise, select the `agent-definition` doc by `(brainId, slug, type, deletedAt is null)`. Miss → throw `AgentNotFoundError`.
  - Parse frontmatter via `js-yaml` and the existing agent-wizard schema (reuse `agentWizardInputSchema` for parsing — cheap safety).
  - Return `AgentRuntimeConfig { id, slug, model, toolAllowlist, skillIds, baselineDocIds, systemPromptSnippet, capabilities }`.
- [ ] Tests: resolves by slug; returns `null` for `platform-agent`; returns `null` for `null`; throws `AgentNotFoundError` on miss; ignores soft-deleted rows; does not cross `brainId` boundary.

**Verification:** `npx vitest run src/lib/agents/__tests__/resolve.test.ts`.

### Task 4 — Runner wiring

**Files:** `src/lib/workflow/run.ts`, `src/lib/workflow/system-prompt.ts`, `src/lib/workflow/__tests__/run.test.ts`.

- [ ] In `runWorkflow`, after loading the workflow doc and frontmatter but before building tools/system:
  - Call `resolveAgentConfigBySlug(brain.id, frontmatter.agent ?? null)`.
  - Wrap in try/catch for `AgentNotFoundError` → `insertEvent('run_error', { reason: 'agent_not_found', slug })` + `markFailed(runId, 'Agent "<slug>" not found')`.
- [ ] When the resolver returns non-null, apply:
  - **Tools:** filter `buildToolSet(...)` output down to names in `toolAllowlist`. If `toolAllowlist` is null/empty, use the full set (matches agent-definition semantics where null = unrestricted).
  - **Capabilities:** thread `capabilities` through the existing `deriveGrantedCapabilities` helper (import the same module the chat route uses — do not re-implement).
  - **Skills:** pass `skillIds` as the `availableSkills` filter into `buildSystemPrompt`. Resolve id → `{id, name, description}` via a single `documents` query scoped to the brain.
  - **Baseline docs:** inject via the same helper the chat route uses for `baselineDocIds`. If the chat route inlines this, document the duplication in a TODO and inline it here too — do not refactor chat in this task.
  - **Persona snippet:** pass `systemPromptSnippet` into `buildWorkflowSystemPrompt` as a new optional `agentPersona` param. Insert between base prompt and workflow preamble.
  - **Model:** pass the resolved model into `runAgentTurn` via the existing override parameter (confirmed in pre-flight).
- [ ] When the resolver returns `null`, behavior is byte-identical to today. Add a test that asserts this.
- [ ] Tests:
  - Workflow with no `agent:` → runner uses full tool set and base prompt (snapshot the tool name list + system prompt).
  - Workflow with `agent: platform-agent` → same as above.
  - Workflow with `agent: <custom>` → tool set is filtered; `availableSkills` is filtered; persona appears in system prompt; model override is passed.
  - Workflow with `agent: <missing>` → run fails with `agent_not_found`.

**Verification:** `npx vitest run src/lib/workflow/__tests__/run.test.ts`.

### Task 5 — API: expose agent list for the workflow UI

**Files:** no new routes. Confirm `GET /api/agents` (existing) returns what the new dropdown needs: `id`, `title`, `slug`. If it doesn't, add `slug` to the select list in `src/app/api/agents/route.ts`.

- [ ] Read `src/app/api/agents/route.ts`. If the returned payload already includes slug, skip. Otherwise add it to the select + update any response tests.

**Verification:** existing agents-route tests.

### Task 6 — UI: new workflow form

**Files:** `src/components/workflows/new-workflow-form.tsx`, co-located test.

- [ ] Fetch `/api/agents` on mount (use SWR — matches existing patterns in the codebase; verify the import path).
- [ ] Render a "Run as" `<select>` below the existing fields. Options: `Platform agent (unrestricted)` (value `''`) first, then each agent-definition by title. Default selected: `''`.
- [ ] On submit, include `agent` in the initial frontmatter only when the user picked a non-empty value. Empty stays absent (not `null`, not `'platform-agent'`) — absent is the canonical default.
- [ ] Tests: dropdown renders options; submitting with platform agent omits `agent`; submitting with a custom agent emits the slug.

**Verification:** co-located component test.

### Task 7 — UI: frontmatter panel on workflow detail

**Files:** `src/components/frontmatter/frontmatter-panel.tsx`, `src/lib/frontmatter/schemas/workflow.ts`.

- [ ] Extend `workflowSchema` to declare the `agent` field with an enum source that resolves at render time from `/api/agents` (document how this plugs into the panel — likely a new "async enum" field type).
- [ ] If the panel doesn't support async enums yet (pre-flight check), render a free-text input for now with placeholder `"platform-agent"`. Ship Task 6's richer dropdown on the new-workflow form regardless.
- [ ] Test the round-trip: load a workflow with `agent: my-agent` → field shows `my-agent` → save without changes → markdown is byte-identical.

**Verification:** existing frontmatter-panel tests + one new round-trip case.

### Task 8 — End-to-end integration test

**Files:** new integration test file under `src/__tests__/integration/` matching the pattern used by existing workflow integration tests.

- [ ] Seed: one brain, one agent-definition (`slug: scoped`, `toolAllowlist: ['read_document']`, `skillIds: [seededSkillId]`, `systemPromptSnippet: 'You are the scoped agent.'`).
- [ ] Create a workflow with `agent: scoped` + a trivial body.
- [ ] Trigger a run (API route). Wait for completion. Assert:
  - System prompt contains the persona snippet.
  - Tool invocations recorded in events only reference tools in the allowlist.
  - Run status reaches `completed`.
- [ ] Create a second workflow with `agent: does-not-exist`. Trigger. Assert status is `failed` with reason `agent_not_found`.

**Verification:** `npx vitest run <integration test path>`.

---

## Open decisions to revisit after shipping

- Per-row agent display on the workflows index (`/workflows`). Skipped in this plan to keep scope tight. Add when the list gets long enough that users need it to identify workflows.
- Whether `null` model in an agent-definition should fall back to a platform default or reject. Handle whichever the chat route does today — don't diverge.
- A future `steps:` array. Not this plan, not this quarter. Revisit once users are running meaningful volumes of single-agent workflows and we know which handoff shapes actually come up.

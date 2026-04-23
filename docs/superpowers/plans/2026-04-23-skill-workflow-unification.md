# Skill + Workflow doc-type unification — implementation plan

**Date:** 2026-04-23
**Spec:** `docs/superpowers/specs/2026-04-23-skill-workflow-unification-design.md`
**Status:** In progress
**Branch policy:** direct on local master (user authorised).

## Problem

See the spec. TL;DR: collapse `type='workflow'` into `type='skill'`
with an optional `trigger:` block.

## Pre-flight

1. Read the spec.
2. Read `src/lib/workflow/run.ts`, `src/lib/workflow/preflight.ts`,
   `src/lib/workflow/system-prompt.ts`,
   `src/lib/brain/frontmatter.ts`,
   `src/lib/frontmatter/schemas/workflow.ts`,
   `src/app/api/brain/documents/[id]/route.ts` (lines 180–264 —
   the metadata sync block),
   `src/app/api/workflows/runs/route.ts`.
3. Note the coordinator work already landed: runWorkflow is using
   platform-agent + Agent dispatch + inherited MCP OUT tools. Do not
   regress any of that.

## Out of scope

See the spec. Do **not**:

- Rename `workflow_runs` table.
- Add usage attribution.
- Migrate `maxSteps` → `stopWhen`.
- Touch marketing copy.
- Wire cron scheduling.

## Tasks

### Task 1: Frontmatter types + validator collapse

**What:** Replace `WorkflowFrontmatter` with `SkillTrigger`. Replace
`validateWorkflowFrontmatter` with `validateSkillTrigger`. Both operate
on the nested block shape (no top-level `type`).

**Files to edit:**

- `src/lib/brain/frontmatter.ts`
  - Remove `WorkflowFrontmatter`, `WorkflowFrontmatterResult`,
    `validateWorkflowFrontmatter`.
  - Add `SkillTrigger` type: `{ schedule: string | null; output:
    'document' | 'message' | 'both'; output_category: string | null;
    requires_mcps: string[] }`.
  - Add `validateSkillTrigger(input: unknown): { ok: true; value:
    SkillTrigger } | { ok: false; errors: ValidationError[] }`.
  - Keep `WorkflowOutputStamp` — still valid (it names the provenance
    stamp middleware writes, unrelated to doc type).
  - Update the `Controlled type vocabulary` comment block to drop
    `workflow` and mention that `skill` carries an optional `trigger:`
    block in its frontmatter.

- `src/lib/frontmatter/schemas/workflow.ts` → move to
  `src/lib/frontmatter/schemas/skill-trigger.ts`:
  - Rename export: `workflowSchema` → `triggerSchema`.
  - `type: 'workflow'` → `type: 'skill-trigger'` (a sentinel string
    that is NOT a doc type — the frontmatter panel uses it to look up
    the trigger-block schema; see Task 5).
  - Keep the four fields. Validator calls `validateSkillTrigger` on
    the raw input (no type injection — trigger blocks don't carry
    type).

- `src/lib/frontmatter/schemas/index.ts`
  - Drop `workflow` from `schemaRegistry`. Do not add `skill` — a
    regular skill has no panel-driven frontmatter (frontmatter is
    user-authored).

**Tests:**

- Rewrite the workflow frontmatter tests under
  `src/lib/frontmatter/schemas/__tests__/` (and
  `src/lib/brain/__tests__/frontmatter.test.ts` if it exists) to use
  the new names and the nested-block shape.
- The round-trip integration test
  (`src/lib/frontmatter/__tests__/integration.round-trip.test.ts`)
  needs its pristine-fixture updated: existing test docs that carried
  `type: workflow` stay `type: skill` with a nested `trigger:`.

**Why first:** every downstream file reads these types. Fix the
vocabulary, then fix the call sites.

---

### Task 2: Data migration script + content rewrite

**What:** One-shot migration script. Rewrites every doc with
`documents.type = 'workflow'` to:

- `type = 'skill'`,
- `metadata = { ...metadata, trigger: { output, output_category,
  requires_mcps, schedule } }` (remove flat keys),
- `content`: rewrite the YAML frontmatter block so `type: workflow`
  becomes `type: skill` and the four fields are nested under
  `trigger:`. Preserve the body unchanged.

**File:** `scripts/migrate-workflow-to-triggered-skill.ts`.

**Shape:**

```ts
// Idempotent: detects already-migrated rows by checking that
// metadata.trigger exists AND type === 'skill'.
// Runs inside a single transaction so partial failure is reversible.
// Logs every touched doc (id, slug, old content hash, new content hash).
// Uses the Supabase MCP project id from MEMORY.md? No — uses the
// project's own @/db connection. Run with `pnpm tsx scripts/...`.
```

**Tests:** a small Vitest case that seeds one workflow doc, runs the
migration, and asserts the resulting row shape + content. Table:
`src/__tests__/migrations/workflow-to-triggered-skill.test.ts`.

**Execution order:** Task 2 runs BEFORE Task 3 against the local dev
DB. In CI (where there are no workflow rows) it's a no-op.

**Why before runtime changes:** the runtime changes in Task 3 read
from `metadata.trigger`. If migration hasn't run, live workflow runs
would break. Running migration first keeps dev workable across every
commit.

---

### Task 3: Runner + preflight + system-prompt relocation

**What:** Move the workflow runtime files under `src/lib/skills/` and
rename the entry point. Keep workflow-run-table-level code
(`src/lib/workflow/stamp-middleware.ts`, `status.ts`, `events.ts`,
`queries.ts`, `access.ts`) where it is — those operate on the
operational `workflow_runs` table which is NOT renamed.

**Files to create / move:**

- `src/lib/skills/run-triggered.ts` ← moved from
  `src/lib/workflow/run.ts`. Exports `runTriggeredSkill(runId)`.
- `src/lib/skills/preflight.ts` ← moved from
  `src/lib/workflow/preflight.ts`. Accepts `SkillTrigger` (not a
  broader frontmatter shape).
- `src/lib/skills/triggered-system-prompt.ts` ← moved from
  `src/lib/workflow/system-prompt.ts`. Exports
  `buildTriggeredSkillSystemPrompt(basePrompt, trigger,
  skillDocPath)`.

**Behavioural edits inside the moved files:**

- `run-triggered.ts`:
  - Load the skill doc, verify `doc.type === 'skill'`.
  - Read `doc.metadata.trigger` (not flat). Call
    `validateSkillTrigger`.
  - If `metadata.trigger` missing or invalid → `markFailed` with
    `reason: 'skill_not_triggerable'` + a clear message.
  - Replace every reference to "workflow" in user-facing messages
    with "skill" or "triggered skill".
  - `workflowDocRef` variable → `skillDocRef`.
- `preflight.ts`: input is a `SkillTrigger` directly. No
  `frontmatter.requires_mcps` intermediate.
- `triggered-system-prompt.ts`: reword the preamble to "You are
  executing the triggered skill defined in X autonomously." Keep the
  coordinator paragraph exactly as shipped.

**Files to delete:** `src/lib/workflow/run.ts`,
`src/lib/workflow/preflight.ts`, `src/lib/workflow/system-prompt.ts`.

**Files to update (import path):**
- `src/app/api/workflows/runs/route.ts` (being rewritten in Task 4
  anyway — note only the breakage).
- `src/__tests__/workflow-coordinator.e2e.test.ts` — update imports.
- Any other test importing from `@/lib/workflow/run|preflight|system-prompt`
  (search first).

**Tests:** the existing preflight, system-prompt and runWorkflow unit
tests migrate with the files. Update fixture metadata to the nested
shape.

**Why:** keeps the filesystem truthful — the user-facing concept is
"triggered skill," code lives where that concept is.

---

### Task 4: API route relocation + sync-block update

**What:** Move `POST /api/workflows/runs` to `POST /api/skills/runs`.
Update the brain-document save path to mirror trigger fields under
`metadata.trigger` when the doc is `type: skill` AND has a `trigger:`
block.

**Files to create / move / edit:**

- Create `src/app/api/skills/runs/route.ts` by moving the body of
  `src/app/api/workflows/runs/route.ts`. In the new handler:
  - Request body field: `skill_document_id` (was
    `workflow_document_id`).
  - Validate `doc.type === 'skill'`.
  - Parse `metadata.trigger` via `validateSkillTrigger`.
  - Return `view_url: "/skills/${doc.id}/runs/${runId}"` (id-based,
    matches the existing skills detail page).
- Delete `src/app/api/workflows/runs/route.ts` and its
  `__tests__/` dir (tests move with the route, with field names
  updated).

- `src/app/api/brain/documents/[id]/route.ts` (lines ~230–263):
  replace the `newType === 'workflow'` branch with `newType ===
  'skill'`. Parse the frontmatter; if it carries a `trigger:` block,
  validate via `validateSkillTrigger` and mirror the validated result
  under `metadata.trigger`. Preserve existing `metadata.trigger`
  fields on skip (same silent-skip policy as today).

- `src/app/api/brain/documents/route.ts` (POST handler): same
  mirror-on-create behaviour for newly authored skill docs with a
  trigger block. Check the existing POST path for any parallel
  workflow branch.

- `src/lib/workflow/queries.ts`: rename
  `getWorkflowDocById` → `getSkillDocById`, update the `type ===
  'workflow'` check to `'skill'`. Keep the file at `src/lib/workflow/`
  (it's operational — queries workflow_runs table).

**Tests:**
- API route tests move to `src/app/api/skills/runs/__tests__/`.
- Document-save tests that cover the workflow sync branch
  (grep for `workflowMetadata` in `__tests__`) update to cover the
  new skill+trigger path.

**Why:** HTTP surface follows the user-facing concept. The
`workflow_runs` table is an internal artefact, so its queries stay
under the `workflow` directory label.

---

### Task 5: Frontmatter panel — optional trigger block

**What:** Let the frontmatter panel render + edit the `trigger:` block
when the current doc is a skill with (or about to have) a trigger.

**Files to edit:**

- `src/components/brain/frontmatter-panel.tsx` (or whichever component
  renders the panel — grep for `getSchema`, `schemaRegistry`):
  - Panel currently uses `getSchema(doc.type)` to decide what to
    render. For `type='skill'`:
    - If the frontmatter body has a `trigger:` key → render the
      `triggerSchema` fields inside a "Trigger" section (collapsed by
      default).
    - If it doesn't → render an "Add trigger" button that, when
      clicked, writes a default `trigger:` block via the existing
      panel write path and reveals the trigger fields.
  - Panel writes to the nested block, not flat frontmatter.

**Tests:** component test covering add-trigger + edit-trigger +
save-without-trigger paths.

**Why:** users need a way to flip a skill into triggerable without
hand-editing YAML. Markdown-first principle: the source of truth stays
in content, the panel is a convenience.

**If this task balloons:** cut it. Users can still edit the trigger
YAML directly in the body. Task 5 is UX polish, not a correctness
requirement. Drop to 5-cut if it eats more than two subagent cycles.

---

### Task 6: UI merge — /skills gains triggerable affordances

**What:** Fold the `/workflows` routes into `/skills`.

**Files to delete:**

- `src/app/(app)/workflows/page.tsx`
- `src/app/(app)/workflows/new/page.tsx`
- `src/app/(app)/workflows/[slug]/page.tsx`
- `src/app/(app)/workflows/[slug]/runs/[id]/page.tsx`
- `src/components/workflows/new-workflow-form.tsx` (create path now
  lives in the NewSkillDropdown).

**Files to edit:**

- `src/app/(app)/skills/page.tsx`:
  - Query now returns all `type='skill'` docs. For each skill, include
    `isTriggerable = metadata.trigger != null` and the latest
    `workflow_runs` row if triggerable.
  - Topbar filter: All / Triggerable / On-demand (URL param
    `?filter=...`).
  - Each triggerable skill card shows a small "Triggerable" affordance
    + last-run status.

- `src/app/(app)/skills/[id]/page.tsx`:
  - If the skill is triggerable: show Run button + recent runs list
    (mirrors `/workflows/[slug]` today).
  - Otherwise: existing skill-detail view unchanged.

- Create `src/app/(app)/skills/[id]/runs/[id]/page.tsx` by moving the
  contents of `src/app/(app)/workflows/[slug]/runs/[id]/page.tsx`.
  Update any internal link to `/skills/[id]/runs/[id]`.

- `src/app/(app)/skills/_components/new-skill-dropdown.tsx`: add a
  "New triggerable skill" menu item that links to a flow creating a
  skill pre-seeded with a `trigger:` block. Either reuse the existing
  "New skill" flow with a `?trigger=1` query param, or add a second
  create path — whichever is lighter.

- `src/components/layout/global-run-badge.tsx`: join on
  `documents.type = 'skill'` instead of `'workflow'`. Link target
  becomes `/skills/[id]/runs/[id]`. Update link strings everywhere in
  this component.

- `src/components/workflows/run-button.tsx`, `run-history-table.tsx`,
  `run-view.tsx`, `run-status-banner.tsx`, `output-card.tsx`,
  `workflow-detail-tabs.tsx`: these are still useful but move under
  `src/components/skills/` or fold into existing skill components if
  the equivalent already exists. Do the simplest rename/move — avoid
  rewriting behaviour.

**Tests:**

- The page test for `/skills/page.tsx` gains assertions for the filter
  toggle + triggerable affordance.
- `/workflows/*` page tests delete with the pages.
- Global-run-badge test updates its join assertion.

**Why:** one list, one detail page, one run view. The user stops
having to decide "is this a skill or a workflow?" before writing the
doc.

---

### Task 7: Cleanup

**What:** Sweep the remaining `'workflow'` type references.

**Checks:**

- `grep -rn "documents.type, 'workflow'" src/` must return zero
  results.
- `grep -rn "type === 'workflow'" src/` must return zero results
  (except inside the migration script).
- `grep -rn "WorkflowFrontmatter" src/` must return zero results.
- `grep -rn "validateWorkflowFrontmatter" src/` must return zero
  results.
- `grep -rn "runWorkflow\b" src/` must return zero results except for
  imports renamed to `runTriggeredSkill`.
- `grep -rn "/api/workflows/runs" src/` must return zero results.
- `/workflows` route directory no longer exists.

**Tests:** run full test suite. Fix any stragglers.

**Why:** rename-refactors always leave orphans. This task is the
discipline pass.

## Cut lines

If pressed for time, cut Task 5 (frontmatter panel UX) first — users
can hand-edit the trigger YAML. Task 6 and Task 7 are non-negotiable.

## Rollback

See the spec — `UPDATE documents SET type='workflow', metadata =
metadata->'trigger' || (metadata - 'trigger') WHERE type='skill' AND
metadata ? 'trigger'` reverses the data change. Code revert: `git
revert` the task commits.

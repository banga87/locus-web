# Skill + Workflow doc-type unification

**Date:** 2026-04-23
**Status:** Design
**Supersedes nothing — follows 2026-04-23-workflow-coordinator-model.md.**

## Problem

Today `documents.type` carries two adjacent values — `skill` and
`workflow` — that describe the same kind of artefact: an authored block
of instructions for an agent to execute. The distinction is that a
workflow has a trigger (schedule, required MCPs, declared output) and a
skill does not. Everything else — storage, editing, versioning, the fact
that the runtime just hands the body to an agent — is identical.

The coordinator-model plan proved this: a workflow run is now "platform
agent loads the body and dispatches subagents as needed." That is
indistinguishable from what `load_skill` does mid-conversation, except
that the workflow runner supplies the triggering context.

Keeping the types separate adds three costs:

1. **UX fragmentation.** The user has two lists (`/skills`, `/workflows`)
   for one concept. They must decide which type they want at create
   time, before knowing whether they'll ever want to trigger it.
2. **Schema drift risk.** Skill and workflow frontmatter are partly
   overlapping (both care about instructions) and partly disjoint
   (trigger fields live only on workflows). Every future field has to
   pick a side.
3. **Duplicate runtime surface.** Two write paths, two validators, two
   registry entries, two index pages. Each one has its own tests and
   its own edge cases.

Pre-customer, pre-deployment: no compatibility constraints. This is
the window to collapse it.

## Goal

One document type: `skill`. A skill is triggerable when its
frontmatter carries a `trigger:` block. A skill with no `trigger:`
block is what we call a "skill" today. A skill with a `trigger:` block
is what we call a "workflow" today.

```
[trigger] → runTriggeredSkill(runId)
         → platform agent (Sonnet, full tools + Agent dispatch)
         → reads skill body + trigger block
         → coordinator dispatches subagents as needed
         → writes final output per trigger.output
```

The existing `workflow_runs` table keeps its name as an operational
artefact (it records runs, not documents) — renaming it would be
cosmetic churn. The module `runWorkflow` is renamed to
`runTriggeredSkill` because it is a consumer-facing concept.

## Target frontmatter shape

A regular skill today:

```yaml
---
name: Translate marketing copy to French
description: ...
source:
  github: { owner: acme, repo: style }
---
```

A triggered skill (today's workflow) after unification:

```yaml
---
type: skill
name: Weekly Linear standup
description: Pulls the last week's Linear activity and summarises top three.
trigger:
  schedule: "0 9 * * MON"          # optional, reserved
  output: document                 # 'document' | 'message' | 'both'
  output_category: product         # folder slug, or null
  requires_mcps: [linear]
---
```

Design decisions:

- **`type: skill` is allowed but optional on skill docs.** Today skills
  sometimes omit `type:` entirely — the schema registry keys off the
  doc's denormalised `documents.type` column rather than frontmatter,
  so a missing `type:` key in the frontmatter is tolerated. We keep
  that tolerance.
- **`trigger:` is a nested block, not flat fields.** It visually groups
  the fields that make a skill triggerable and makes it trivial for
  readers (and the frontmatter panel) to detect triggerability —
  "does `trigger:` exist?" — without probing for specific keys.
- **`schedule:` stays reserved.** Cron-driven runs are out of scope for
  this plan; the field is accepted (validated as a string or null) so
  docs can carry it for future use, but nothing reads it yet.
- **No new fields.** We are collapsing, not extending. Any new
  capability (per-skill model selection, permissions, etc.) is a
  follow-up.

## Approach

### Database

- No schema migration for `documents`. `documents.type` is a plain
  `text` column; the only enforced invariant for triggerability is the
  application-level branch on `type === 'skill' && metadata.trigger !=
  null`.
- One data migration rewrites existing workflow docs:
  - `type`: `'workflow'` → `'skill'`
  - `metadata`: existing flat fields (`output`, `output_category`,
    `requires_mcps`, `schedule`) are moved into `metadata.trigger`.
  - `content`: the YAML frontmatter block in the doc body is rewritten
    so `type: workflow` becomes `type: skill` and the four fields are
    nested under `trigger:`. Content and metadata must not drift — the
    editor round-trips through content.

The migration lives in `scripts/migrate-workflow-to-triggered-skill.ts`
(one-shot script, not a Drizzle migration) and is idempotent (detects
already-migrated rows by checking `metadata.trigger` shape).

### Frontmatter and schemas

- `WorkflowFrontmatter` type collapses into a new `SkillTrigger`
  type: `{ schedule: string | null; output: 'document' | 'message' |
  'both'; output_category: string | null; requires_mcps: string[] }`.
- `validateWorkflowFrontmatter` becomes `validateSkillTrigger` with the
  same tagged-union result shape. Consumers inject the trigger block
  rather than the full doc frontmatter.
- `workflowSchema` in `src/lib/frontmatter/schemas/workflow.ts` is
  replaced by a `triggerSchema` that describes the nested block. The
  frontmatter panel renders it conditionally: when the doc's
  `documents.type === 'skill'` AND the frontmatter body contains a
  `trigger:` key, the panel shows the trigger fields. When there's no
  `trigger:`, a "Make this triggerable" button adds it (writes a
  default block).
- `schemaRegistry` loses the `workflow` key. Nothing else registers
  under `'skill'` — skill frontmatter is authored by the user directly
  in the body, not driven by the panel.

### Runtime

- `src/lib/workflow/run.ts` → `src/lib/skills/run-triggered.ts`.
  `runWorkflow(runId)` → `runTriggeredSkill(runId)`. Reads
  `metadata.trigger` instead of flat metadata.
- `src/lib/workflow/preflight.ts` → `src/lib/skills/preflight.ts`.
  Accepts `SkillTrigger` directly (not a broader frontmatter shape).
- `src/lib/workflow/system-prompt.ts` → `src/lib/skills/
  triggered-system-prompt.ts`. Signature takes `SkillTrigger` instead
  of `WorkflowFrontmatter`.
- `src/lib/workflow/stamp-middleware.ts`, `status.ts`, `events.ts`,
  `queries.ts`, `access.ts` stay under `src/lib/workflow/` (they
  operate on `workflow_runs` rows, which keep their table name). We
  move only the code that touches doc-level concepts.

### API

- `POST /api/workflows/runs` → `POST /api/skills/runs`. The trigger
  path lives under the user-facing concept. Body:
  `{ skill_document_id: string }`.
- Response shape unchanged except `view_url`: `/workflows/[slug]/runs/[id]`
  → `/skills/[id]/runs/[id]`.
- `workflow_runs` table name unchanged. The returned run id is just a
  uuid either way.

### UI

- `/workflows` (index page, detail page, run view) deleted. Routes
  removed.
- `/skills` becomes the only index. Each skill card shows a small
  "Triggerable" marker when the doc has a `trigger:` block. A filter
  toggle in the topbar: "All / Triggerable / On-demand".
- `/skills/[id]` (skill detail page) gains a "Run" button + run
  history section when the skill is triggerable.
- `NewWorkflowForm` deleted. `NewSkillDropdown` gets a third option:
  "New triggerable skill" that seeds the body with a `trigger:` block.
- Run detail page moves from `/workflows/[slug]/runs/[id]` to
  `/skills/[id]/runs/[id]`.

### Global badge, access, events

- `GlobalRunBadge` (src/components/layout/global-run-badge.tsx) joins
  `workflow_runs` to `documents` on `type='skill'` (was `'workflow'`).
- Access checks in `src/lib/workflow/access.ts` change any
  `doc.type === 'workflow'` branches to `doc.type === 'skill' &&
  hasTrigger(doc)`.
- Events module unchanged.

## Out of scope

- **Usage attribution** (`workflow_run_id` FK on `usage_records`).
  Separate follow-up.
- **AI SDK v6 `maxSteps` → `stopWhen: stepCountIs(N)` migration.**
  Pre-existing; linter keeps flagging it.
- **Per-skill coordinator model choice** (Sonnet vs Haiku). Separate
  lever.
- **Cron scheduling.** `schedule:` accepted in frontmatter, nothing
  reads it yet.
- **`workflow_runs` table rename.** Operational, not user-facing —
  cosmetic churn with wide blast radius. Keep.
- **Marketing/copy audit** to purge "workflow" from user-facing
  language. Will surface in UI review after the merge.

## Rollback

Pre-customer; no rollback plan needed. If the unification regresses
something, `git revert` to the pre-plan state — the data migration is
the only non-code change and is easy to reverse with
`UPDATE documents SET type='workflow', metadata = metadata->'trigger'
|| (metadata - 'trigger') WHERE type='skill' AND metadata ? 'trigger'`.

# Subagent Harness (Pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a platform-owned subagent dispatch layer (mirroring Claude Code's `AgentTool` pattern) and the first built-in agent, **BrainExplore**, so the Platform Agent can delegate brain-navigation work to a cheaper, read-only subagent instead of burning its own turn budget.

**Architecture:** Three new concerns added to the existing harness without modifying it. (1) A **model registry** using Vercel AI Gateway BYOK (`@ai-sdk/gateway`) with a compile-checked `ApprovedModelId` union and per-agent env overrides. (2) A **subagent layer** (`src/lib/subagent/`) with a dispatch tool, a `runSubagent` that calls the existing `runAgentTurn`, a `filterSubagentTools` wrapper that strips tools per agent allow/deny lists, and a registry of `BuiltInAgentDefinition`s. (3) The **BrainExplore** built-in agent — Haiku 4.5 default, read-only brain tools, structured Sources output with slug+id citations enforced by a validator. Feature-flagged; schema migration additive; zero harness edits.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Vercel AI SDK 6 (`ai@^6.0.158`), `@ai-sdk/gateway`, `@ai-sdk/anthropic`, `@ai-sdk/google`, Drizzle ORM on Supabase Postgres, Vitest.

**Spec:** [`docs/superpowers/specs/2026-04-19-subagent-harness-pilot-design.md`](../specs/2026-04-19-subagent-harness-pilot-design.md)
**Catalog:** [`locus-brain/design/agent-harness/11-built-in-agents.md`](../../../../locus-brain/design/agent-harness/11-built-in-agents.md)
**Worktree:** Create before starting (Pre-flight below). All paths below are relative to the worktree root (`locus-web/`).

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/lib/models/approved-models.ts` | `APPROVED_MODELS` const + `ApprovedModelId` union + `isApprovedModelId` type guard. Pure. |
| `src/lib/models/registry.ts` | `getModel(id)` — thin wrapper around `@ai-sdk/gateway`. |
| `src/lib/models/resolve.ts` | `resolveModel(agentSlug, defaultModel)` — env override + `slugToEnv`. |
| `src/lib/models/__tests__/approved-models.test.ts` | Type-guard + membership tests. |
| `src/lib/models/__tests__/resolve.test.ts` | Override parsing, invalid-override warning, default fallback, `slugToEnv` cases. |
| `src/lib/subagent/types.ts` | `BuiltInAgentDefinition`, `OutputContract`, `SubagentResult`, `SubagentInvocation` types. Pure type module. |
| `src/lib/subagent/registry.ts` | `getBuiltInAgent(agentType)`, `getBuiltInAgents()`. |
| `src/lib/subagent/filter.ts` | `filterSubagentTools(fullToolset, def)` — applies allow/deny lists to `buildToolSet` output. |
| `src/lib/subagent/validators.ts` | `validateOutputContract(text, contract)` — runs freeform/verdict/json validators. |
| `src/lib/subagent/prompt.ts` | `buildAgentToolDescription(agents)` — dynamic `Agent` tool description. |
| `src/lib/subagent/runSubagent.ts` | The dispatcher. Builds subagent context, filters tools, calls `runAgentTurn`, runs validator, emits audit + usage. |
| `src/lib/subagent/AgentTool.ts` | `buildAgentTool(parentCtx, options)` — AI SDK `tool()` wrapper around `runSubagent`. Caps enforcement. |
| `src/lib/subagent/built-in/brainExploreAgent.ts` | `BRAIN_EXPLORE_AGENT` definition: model, tools, system prompt, `maxTurns`, output-contract validator. |
| `src/lib/subagent/__tests__/registry.test.ts` | Registry returns known agents, `undefined` for unknown. |
| `src/lib/subagent/__tests__/filter.test.ts` | Allowlist / denylist / Agent-tool always-stripped / empty-result behavior. |
| `src/lib/subagent/__tests__/validators.test.ts` | Freeform validator happy path + failure, verdict-line enforcement stub, json Zod stub. |
| `src/lib/subagent/__tests__/prompt.test.ts` | Dynamic description renders correctly for 0/1/N agents. |
| `src/lib/subagent/__tests__/runSubagent.test.ts` | Fresh session, scope filtering, tool filtering, hook fires, `maxTurns` threaded, abort propagates, validator runs, audit+usage written, error paths (unknown type, cap exceeded, validator fail, abort, provider error). |
| `src/lib/subagent/__tests__/AgentTool.test.ts` | Zod schema, unknown type → structured error, cap enforcement, parallel calls. |
| `src/lib/subagent/__tests__/brain-explore.integration.test.ts` | Seeded brain + recorded Haiku stream → output format, validator pass, `usage_records` + audit event written. |
| `src/lib/subagent/__tests__/parent-spawn-parallel.test.ts` | Ten-call cap enforcement across a simulated parent turn. |
| `src/lib/subagent/__tests__/output-contract-failure.test.ts` | Malformed Sources block → `{ ok: false, partialText }`. |
| `src/lib/subagent/evals/brain-explore/README.md` | How to run the eval suite, scope, golden-set maintenance. |
| `src/lib/subagent/evals/brain-explore/golden-set.ts` | 15-20 fixture queries with expected slugs. |
| `src/lib/subagent/evals/brain-explore/runner.ts` | CLI runner accepting `--model=<ApprovedModelId>`; computes metrics; writes results. |
| `src/db/migrations/NNNN_add_parent_usage_record_id.sql` | Additive migration for subagent cost attribution. |

### Existing files to modify

| File | Change |
|---|---|
| `package.json` | Add `@ai-sdk/google` and `@ai-sdk/gateway` to dependencies. |
| `src/db/schema/usage-records.ts` | Add `parentUsageRecordId` (UUID, nullable, self-FK, indexed). |
| `src/lib/audit/types.ts` | Add `'agent'` to `AuditEventCategory` union. |
| `src/db/schema/enums.ts` | (If the audit category is a pgEnum) add `'agent'` value. Confirm during Task 5. |
| `src/lib/usage/record.ts` | Accept `source` param (default `'platform_agent'`) and `parentUsageRecordId`. Return the inserted row's `id` so the caller can attribute children. |
| `src/app/api/agent/chat/route.ts` | Behind `TATARA_SUBAGENTS_ENABLED`, construct `buildAgentTool(parentCtx)` and pass in `externalTools` of `buildToolSet`. |
| `src/app/api/agent/chat/__tests__/route.test.ts` | Smoke: tool present when flag on, absent when off. |
| `.env.example` | Document `TATARA_SUBAGENTS_ENABLED` and `TATARA_MODEL_OVERRIDE_<SLUG>` pattern. |

### Commands reference

```bash
npx vitest run <path-to-test>       # one-shot
npx vitest <path-to-test>           # watch mode
npm run lint                         # eslint + harness-boundary check
npx tsc --noEmit                     # type-check (no build script for unit-only)
npx drizzle-kit generate             # produce migration SQL
npx drizzle-kit migrate              # apply migration to local DB
```

---

## Pre-flight

- [ ] **P.1** — Create a worktree for this feature.

  Use the `superpowers:using-git-worktrees` skill. Suggested branch name: `subagent-harness-pilot`. All paths below are relative to the worktree root.

- [ ] **P.2** — Verify local dev environment.

  ```bash
  npx tsc --noEmit
  npm run lint
  npx vitest run src/lib/agent
  ```
  Expected: all green. If red, fix before proceeding — this plan assumes a clean baseline.

- [ ] **P.3** — Read the spec + catalog once.

  Files: `docs/superpowers/specs/2026-04-19-subagent-harness-pilot-design.md`, `../../locus-brain/design/agent-harness/11-built-in-agents.md`, and `AGENTS.md` (harness boundary rules).

---

## Task 1: Add provider dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@ai-sdk/google` and `@ai-sdk/gateway`**

  ```bash
  npm install @ai-sdk/google @ai-sdk/gateway
  ```

- [ ] **Step 2: Verify install**

  ```bash
  node -e "console.log(require('@ai-sdk/gateway/package.json').version); console.log(require('@ai-sdk/google/package.json').version)"
  ```
  Expected: two version strings, no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add package.json package-lock.json
  git commit -m "chore: add @ai-sdk/gateway and @ai-sdk/google for subagent pilot"
  ```

---

## Task 2: `approved-models.ts` — compile-checked model union

**Files:**
- Create: `src/lib/models/approved-models.ts`
- Create: `src/lib/models/__tests__/approved-models.test.ts`

- [ ] **Step 1: Write the failing test**

  `src/lib/models/__tests__/approved-models.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    APPROVED_MODELS,
    isApprovedModelId,
  } from '../approved-models';

  describe('APPROVED_MODELS', () => {
    it('exports anthropic + google models in the pilot scope', () => {
      expect(APPROVED_MODELS).toContain('anthropic/claude-haiku-4.5');
      expect(APPROVED_MODELS).toContain('anthropic/claude-sonnet-4.6');
      expect(APPROVED_MODELS).toContain('google/gemini-2.5-flash-lite');
      expect(APPROVED_MODELS).toContain('google/gemini-2.5-pro');
    });

    it('has no duplicates', () => {
      expect(new Set(APPROVED_MODELS).size).toBe(APPROVED_MODELS.length);
    });
  });

  describe('isApprovedModelId', () => {
    it('accepts approved ids', () => {
      expect(isApprovedModelId('anthropic/claude-haiku-4.5')).toBe(true);
    });

    it('rejects unknown ids', () => {
      expect(isApprovedModelId('anthropic/claude-opus-5')).toBe(false);
      expect(isApprovedModelId('')).toBe(false);
      expect(isApprovedModelId('anthropic:claude-haiku-4.5')).toBe(false); // wrong separator
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx vitest run src/lib/models/__tests__/approved-models.test.ts`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

  `src/lib/models/approved-models.ts`:
  ```ts
  // Compile-checked list of model IDs the subagent harness and any future
  // caller is allowed to pass to the Vercel AI Gateway. Adding a new model
  // here is intentionally a code change (not a config change) so that
  // model selection is reviewable.
  //
  // ID format = `<provider>/<model>` matching Gateway conventions. Version
  // numbers use dots, not hyphens (e.g. `claude-sonnet-4.6`, not `-4-6`).

  export const APPROVED_MODELS = [
    // Anthropic
    'anthropic/claude-haiku-4.5',
    'anthropic/claude-sonnet-4.6',
    'anthropic/claude-opus-4.7',
    // Google
    'google/gemini-2.5-flash-lite',
    'google/gemini-2.5-flash',
    'google/gemini-2.5-pro',
  ] as const;

  export type ApprovedModelId = (typeof APPROVED_MODELS)[number];

  export function isApprovedModelId(value: string): value is ApprovedModelId {
    return (APPROVED_MODELS as readonly string[]).includes(value);
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npx vitest run src/lib/models/__tests__/approved-models.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/models/approved-models.ts src/lib/models/__tests__/approved-models.test.ts
  git commit -m "feat(models): approved-models union + isApprovedModelId guard"
  ```

---

## Task 3: `registry.ts` — Vercel AI Gateway model accessor

**Files:**
- Create: `src/lib/models/registry.ts`

- [ ] **Step 1: Implement the module**

  `src/lib/models/registry.ts`:
  ```ts
  // Single entry point for resolving an ApprovedModelId to an AI SDK
  // LanguageModel handle. All model calls in the subagent layer go
  // through here. Auth is BYOK: our Anthropic + Google provider API keys
  // live in Vercel's Gateway BYOK configuration (managed via Vercel
  // dashboard / CLI), not in application env or code. Zero Gateway markup
  // on tokens — our existing provider billing relationships are preserved.
  // The Gateway layers unified auth, cost tracking, failover, and routing
  // on top.
  //
  // The existing Platform Agent in src/lib/agent/ still calls Anthropic
  // directly today; migrating that to the Gateway is a separate follow-up
  // and is NOT in pilot scope. The two paths coexist during the
  // migration window.

  import { gateway } from '@ai-sdk/gateway';
  import type { ApprovedModelId } from './approved-models';

  export function getModel(id: ApprovedModelId) {
    return gateway(id);
  }
  ```

  No test for `registry.ts` itself — it's a one-line passthrough to a third-party. The integration tests in Task 13 exercise it end-to-end with a mocked stream.

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/models/registry.ts
  git commit -m "feat(models): getModel via Vercel AI Gateway (BYOK)"
  ```

---

## Task 4: `resolve.ts` — env-override resolver

**Files:**
- Create: `src/lib/models/resolve.ts`
- Create: `src/lib/models/__tests__/resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

  `src/lib/models/__tests__/resolve.test.ts`:
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
  import { resolveModel, slugToEnv } from '../resolve';

  describe('slugToEnv', () => {
    it('transforms PascalCase to SCREAMING_SNAKE_CASE', () => {
      expect(slugToEnv('BrainExplore')).toBe('BRAIN_EXPLORE');
      expect(slugToEnv('DCPVerifier')).toBe('DCP_VERIFIER');
      expect(slugToEnv('WebResearch')).toBe('WEB_RESEARCH');
      expect(slugToEnv('ChangeClassifier')).toBe('CHANGE_CLASSIFIER');
    });
  });

  describe('resolveModel', () => {
    const ORIGINAL_ENV = { ...process.env };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    beforeEach(() => {
      process.env = { ...ORIGINAL_ENV };
      warnSpy.mockClear();
    });

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it('uses the default when no env override is set', () => {
      delete process.env.TATARA_MODEL_OVERRIDE_BRAIN_EXPLORE;
      const model = resolveModel('BrainExplore', 'anthropic/claude-haiku-4.5');
      expect(model).toBeDefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('uses a valid env override', () => {
      process.env.TATARA_MODEL_OVERRIDE_BRAIN_EXPLORE = 'google/gemini-2.5-flash-lite';
      const model = resolveModel('BrainExplore', 'anthropic/claude-haiku-4.5');
      expect(model).toBeDefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns and falls back when the env override is not in APPROVED_MODELS', () => {
      process.env.TATARA_MODEL_OVERRIDE_BRAIN_EXPLORE = 'openai/gpt-5';
      const model = resolveModel('BrainExplore', 'anthropic/claude-haiku-4.5');
      expect(model).toBeDefined();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/Invalid override/);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npx vitest run src/lib/models/__tests__/resolve.test.ts`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

  `src/lib/models/resolve.ts`:
  ```ts
  // Per-agent model resolution with env-var override.
  //
  // Env key format: TATARA_MODEL_OVERRIDE_<SLUG_IN_SCREAMING_SNAKE>
  // Env value format: ApprovedModelId verbatim (e.g. 'google/gemini-2.5-flash-lite').
  //
  // Invalid overrides (not in APPROVED_MODELS) log a warning and fall back
  // to the agent's default. Never throws.

  import { getModel } from './registry';
  import {
    isApprovedModelId,
    type ApprovedModelId,
  } from './approved-models';

  export function slugToEnv(slug: string): string {
    return slug.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  }

  export function resolveModel(
    agentSlug: string,
    defaultModel: ApprovedModelId,
  ) {
    const envKey = `TATARA_MODEL_OVERRIDE_${slugToEnv(agentSlug)}`;
    const override = process.env[envKey];
    let modelId: ApprovedModelId = defaultModel;
    if (override) {
      if (isApprovedModelId(override)) {
        modelId = override;
      } else {
        console.warn(
          `[models] Invalid override for ${agentSlug} via ${envKey}: ${override}; using default ${defaultModel}`,
        );
      }
    }
    return getModel(modelId);
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npx vitest run src/lib/models/__tests__/resolve.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/models/resolve.ts src/lib/models/__tests__/resolve.test.ts
  git commit -m "feat(models): resolveModel + slugToEnv with env-override fallback"
  ```

---

## Task 5: Schema migration — `parent_usage_record_id`

**Files:**
- Modify: `src/db/schema/usage-records.ts`
- Create: `src/db/migrations/NNNN_add_parent_usage_record_id.sql` (generated)

- [ ] **Step 1: Add the column to the Drizzle schema**

  In `src/db/schema/usage-records.ts`, add between the `metadata` and `createdAt` columns (or wherever alphabetically fits):
  ```ts
  // FK to the parent LLM call's usage_records row. NULL for Platform Agent
  // / top-level calls; populated for subagent invocations. Enables
  // attribution queries summing parent + child token spend for a single
  // conversational turn. See 2026-04-19 subagent harness spec §7.
  parentUsageRecordId: uuid('parent_usage_record_id'),
  ```

  And add the index in the index array:
  ```ts
  index('usage_records_parent_usage_record_id_idx').on(
    table.parentUsageRecordId,
  ),
  ```

  The self-referencing FK is added in raw SQL in Step 2 because Drizzle's `.references(() => usageRecords.id)` on the same table it's inside creates a type cycle in some setups — handle it in the generated migration instead.

- [ ] **Step 2: Generate the migration**

  ```bash
  npx drizzle-kit generate
  ```

  Inspect the generated `.sql` under `src/db/migrations/`. Add the FK constraint if the generator didn't include it:
  ```sql
  ALTER TABLE usage_records
    ADD CONSTRAINT usage_records_parent_usage_record_id_fk
    FOREIGN KEY (parent_usage_record_id) REFERENCES usage_records(id)
    ON DELETE SET NULL;
  ```

- [ ] **Step 3: Apply to local DB**

  ```bash
  npx drizzle-kit migrate
  ```

  Verify with:
  ```bash
  npx tsx -e "import {db} from './src/db'; import {usageRecords} from './src/db/schema'; db.select().from(usageRecords).limit(1).then(r => { console.log('schema ok', Object.keys(r[0] ?? {parentUsageRecordId: null})); process.exit(0); });"
  ```
  Expected: the result's keys include `parentUsageRecordId`.

- [ ] **Step 4: Run the existing usage tests**

  ```bash
  npx vitest run src/lib/usage
  ```
  Expected: existing `recordUsage` tests still pass (the column is nullable and unused).

- [ ] **Step 5: Commit**

  ```bash
  git add src/db/schema/usage-records.ts src/db/migrations/
  git commit -m "feat(db): add parent_usage_record_id for subagent attribution"
  ```

---

## Task 6: Extend `recordUsage` for subagent attribution

**Files:**
- Modify: `src/lib/usage/record.ts`
- Modify: `src/lib/usage/__tests__/record.test.ts`

- [ ] **Step 1: Write the failing tests**

  Add to `src/lib/usage/__tests__/record.test.ts`:
  Full mock chain for `db.insert(...).values(...).returning(...)` — mirror what `record.test.ts` already sets up for `db.insert(...).values(...)`. The `.returning` call is new in this task; the mock must return `[{ id: '<uuid>' }]` so `recordUsage` can propagate the row id.

  ```ts
  it('records source and parentUsageRecordId when supplied', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'inserted-id' }]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    vi.mocked(db.insert).mockImplementation(insert);

    const parentId = crypto.randomUUID();
    await recordUsage({
      companyId: 'c1',
      sessionId: null,
      userId: 'u1',
      modelId: 'anthropic/claude-haiku-4.5',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      source: 'subagent',
      parentUsageRecordId: parentId,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'subagent',
        parentUsageRecordId: parentId,
      }),
    );
  });

  it('defaults source to platform_agent when not supplied', async () => {
    /* mock chain as above */
    await recordUsage({ /* ... no source */ });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'platform_agent' }),
    );
  });

  it('returns the inserted row id', async () => {
    const row = { id: 'generated-uuid' };
    /* ... mock returning(row) */
    const result = await recordUsage({ /* ... */ });
    expect(result).toEqual({ id: 'generated-uuid' });
  });
  ```

  Follow the existing test's mock-setup pattern for the Drizzle chain — read the top of the existing file first.

- [ ] **Step 2: Run to verify failure**

  Run: `npx vitest run src/lib/usage/__tests__/record.test.ts`
  Expected: new tests FAIL; existing tests PASS.

- [ ] **Step 3: Add haiku 4.5 (no date suffix) rates**

  The existing `PROVIDER_COST_PER_1K_TOKENS` has `anthropic/claude-haiku-4-5-20251001` (hyphens + date). Add a parallel entry for the Gateway ID:
  ```ts
  'anthropic/claude-haiku-4.5': {
    input: 0.001,
    cachedInput: 0.0001,
    output: 0.005,
  },
  'anthropic/claude-sonnet-4.6': {
    input: 0.003,
    cachedInput: 0.0003,
    output: 0.015,
  },
  'google/gemini-2.5-flash-lite': {
    // Source: locus-brain/research/model-selection-analysis.md.
    // $0.10 in / $0.40 out per 1M tokens; cache $0.01 per 1M.
    input: 0.0001,
    cachedInput: 0.00001,
    output: 0.0004,
  },
  'google/gemini-2.5-flash': {
    input: 0.0003,
    cachedInput: 0.00003,
    output: 0.0025,
  },
  'google/gemini-2.5-pro': {
    // Tiered pricing; this is the <=200k input rate. Over-200k callers must
    // price-adjust before inserting — track in S3 follow-up.
    input: 0.00125,
    cachedInput: 0.000125,
    output: 0.010,
  },
  'anthropic/claude-opus-4.7': {
    input: 0.005,
    cachedInput: 0.0005,
    output: 0.025,
  },
  ```

  All six `APPROVED_MODELS` must have rate entries. A missing rate causes `recordUsage` to log `[usage] unknown model rates` and skip the insert — which silently drops subagent cost attribution.

- [ ] **Step 4: Widen `RecordUsageParams` and return shape**

  ```ts
  interface RecordUsageParams {
    companyId: string;
    sessionId: string | null;
    userId: string | null;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    /** Default 'platform_agent'. 'subagent' for built-in subagent calls. */
    source?: 'platform_agent' | 'maintenance_agent' | 'mcp' | 'system' | 'subagent';
    /** FK to the parent LLM call's usage_records.id. Null for top-level calls. */
    parentUsageRecordId?: string | null;
  }

  export async function recordUsage(
    params: RecordUsageParams,
  ): Promise<{ id: string } | null> {
    /* ... existing cost math ... */
    try {
      const [row] = await db
        .insert(usageRecords)
        .values({
          /* ... existing fields ... */
          source: params.source ?? 'platform_agent',
          parentUsageRecordId: params.parentUsageRecordId ?? null,
          metadata: cached > 0 ? { cachedInputTokens: cached } : {},
        })
        .returning({ id: usageRecords.id });
      return row ?? null;
    } catch (err) {
      console.error('[usage] insert failed', err);
      return null;
    }
  }
  ```

- [ ] **Step 5: Run tests to verify they pass**

  Run: `npx vitest run src/lib/usage/__tests__/record.test.ts`
  Expected: PASS.

- [ ] **Step 6: Update the existing chat route call-site**

  `src/app/api/agent/chat/route.ts` — find the `recordUsage({...})` call (inside `onFinish`) and either leave as-is (defaults will apply) OR destructure the return value so future propagation works. At minimum verify the call still compiles.

- [ ] **Step 7: Full type-check + lint**

  ```bash
  npx tsc --noEmit
  npm run lint
  ```
  Expected: no errors.

- [ ] **Step 8: Commit**

  ```bash
  git add src/lib/usage/ src/app/api/agent/chat/
  git commit -m "feat(usage): accept source + parentUsageRecordId, return inserted row id"
  ```

---

## Task 7: Add `agent` audit category

**Files:**
- Modify: `src/lib/audit/types.ts`
- Modify: `src/db/schema/enums.ts` (if pgEnum) or relevant schema file
- Create migration if enum is DB-side

`AuditEventCategory` is backed by a **pgEnum** (`auditEventCategoryEnum` in `src/db/schema/enums.ts:48`). Postgres `ALTER TYPE ... ADD VALUE` **cannot run inside a transaction block**, and Drizzle's default migrator wraps statements in a tx. The task ships a raw `.sql` file with `--no-transaction` semantics (an empty `statement-breakpoint` on its own line tells Drizzle to close the preceding tx before running `ALTER TYPE`).

- [ ] **Step 1: Confirm the enum exists and its current values**

  ```bash
  npx tsx -e "import {auditEventCategoryEnum} from './src/db/schema/enums'; console.log(auditEventCategoryEnum.enumValues);"
  ```
  Expected output includes at least: `['document_access','document_mutation','proposal','confidence','authentication','maintenance','administration','token_usage','mcp_invocation']`.

- [ ] **Step 2: Extend `AuditEventCategory`**

  `src/lib/audit/types.ts`:
  ```ts
  export type AuditEventCategory =
    | 'document_access'
    | 'document_mutation'
    | 'proposal'
    | 'confidence'
    | 'authentication'
    | 'maintenance'
    | 'administration'
    | 'token_usage'
    | 'mcp_invocation'
    | 'agent'; // NEW — subagent invocations
  ```

- [ ] **Step 3: Also add `'agent'` to the pgEnum values in `src/db/schema/enums.ts`**

  ```ts
  export const auditEventCategoryEnum = pgEnum('audit_event_category', [
    /* existing values... */
    'agent', // NEW
  ]);
  ```

- [ ] **Step 4: Generate and patch the migration**

  ```bash
  npx drizzle-kit generate
  ```

  Open the generated `.sql`. If Drizzle emits a single `ALTER TYPE ... ADD VALUE` statement, append a `--> statement-breakpoint` line **before** it so the migrator commits the transaction first:

  ```sql
  --> statement-breakpoint
  ALTER TYPE "audit_event_category" ADD VALUE IF NOT EXISTS 'agent';
  ```

  If the generator nests the statement inside a larger transaction block, split it into its own `.sql` file and add the `statement-breakpoint` marker manually.

- [ ] **Step 5: Apply and verify**

  ```bash
  npx drizzle-kit migrate
  npx tsx -e "import {db} from './src/db'; db.execute({sql:\"SELECT unnest(enum_range(NULL::audit_event_category))::text\", params:[]}).then(r => { console.log(r); process.exit(0); });"
  ```
  Expected: the result set contains `'agent'`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/audit/types.ts src/db/
  git commit -m "feat(audit): add 'agent' category for subagent invocations"
  ```

---

## Task 8: Subagent types module

**Files:**
- Create: `src/lib/subagent/types.ts`

- [ ] **Step 1: Implement the module**

  ```ts
  // Type-only module for the subagent layer. No runtime side effects.
  // Keeps the public contract for built-in agents stable even as the
  // dispatcher (runSubagent) evolves.

  import type { Tool } from 'ai';
  import type { AgentContext } from '@/lib/agent/types';
  import type { ApprovedModelId } from '@/lib/models/approved-models';

  export interface OutputContract {
    type: 'freeform' | 'verdict' | 'json';
    /**
     * Optional validator. Return { ok: true } to pass; { ok: false, reason }
     * to force the dispatcher to return a failure result to the caller.
     * Pure function — no DB or I/O.
     */
    validator?: (text: string) => { ok: true } | { ok: false; reason: string };
  }

  export interface BuiltInAgentDefinition {
    /** Unique slug; also used as agentDefinitionId prefix: `builtin:<slug>`. */
    agentType: string;
    /** Parent-facing description rendered into the Agent tool description. */
    whenToUse: string;
    /** Model choice. 'inherit' reuses the parent's model; an ApprovedModelId routes via the Gateway. */
    model: ApprovedModelId | 'inherit';
    /** Explicit allowlist of tool names. Mutually exclusive with disallowedTools. */
    tools?: string[];
    /** Denylist of tool names. Typical for read-only agents. */
    disallowedTools?: string[];
    /** Builder for the agent's system prompt. Called once per dispatch. */
    getSystemPrompt: () => string;
    /** If true, skip manifest injection. Agent must call manifest_read itself if needed. */
    omitBrainContext?: boolean;
    /** Reserved — not wired in pilot. */
    background?: boolean;
    /** Max internal tool-loop steps. Default 15 when unset. */
    maxTurns?: number;
    /** Optional post-hoc validation of the subagent's final text. */
    outputContract?: OutputContract;
  }

  export interface SubagentInvocation {
    description: string;
    subagent_type: string;
    prompt: string;
  }

  export type SubagentResult =
    | {
        ok: true;
        text: string;
        usage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
          cachedInputTokens?: number;
        };
        subagentType: string;
      }
    | {
        ok: false;
        error: string;
        /** Partial output captured before failure (validator fail / maxTurns / etc.). */
        partialText?: string;
      };

  /**
   * Context handed to runSubagent by the Agent tool. Separates the caller's
   * concerns (invocation params) from the harness concerns (parent context,
   * parent usage record id for attribution).
   */
  export interface SubagentDispatchContext {
    parentCtx: AgentContext;
    parentUsageRecordId: string | null;
  }
  ```

- [ ] **Step 2: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/subagent/types.ts
  git commit -m "feat(subagent): type module for BuiltInAgentDefinition + SubagentResult"
  ```

---

## Task 9: `filterSubagentTools` helper

**Files:**
- Create: `src/lib/subagent/filter.ts`
- Create: `src/lib/subagent/__tests__/filter.test.ts`

- [ ] **Step 1: Write the failing tests**

  ```ts
  import { describe, expect, it } from 'vitest';
  import type { Tool } from 'ai';
  import { filterSubagentTools } from '../filter';
  import type { BuiltInAgentDefinition } from '../types';

  const fakeTool = {} as Tool;
  const allTools: Record<string, Tool> = {
    manifest_read: fakeTool,
    search_documents: fakeTool,
    get_document: fakeTool,
    write_document: fakeTool,
    update_frontmatter: fakeTool,
    Agent: fakeTool,
  };

  const def = (partial: Partial<BuiltInAgentDefinition>): BuiltInAgentDefinition =>
    ({
      agentType: 'Test',
      whenToUse: 'test',
      model: 'anthropic/claude-haiku-4.5',
      getSystemPrompt: () => '',
      ...partial,
    } as BuiltInAgentDefinition);

  describe('filterSubagentTools', () => {
    it('always strips the Agent tool regardless of config', () => {
      const out = filterSubagentTools(allTools, def({}));
      expect(out.Agent).toBeUndefined();
    });

    it('applies an allowlist when tools is set', () => {
      const out = filterSubagentTools(allTools, def({
        tools: ['manifest_read', 'search_documents'],
      }));
      expect(Object.keys(out).sort()).toEqual(['manifest_read', 'search_documents']);
    });

    it('applies a denylist when disallowedTools is set', () => {
      const out = filterSubagentTools(allTools, def({
        disallowedTools: ['write_document', 'update_frontmatter'],
      }));
      expect(out.write_document).toBeUndefined();
      expect(out.update_frontmatter).toBeUndefined();
      expect(out.manifest_read).toBeDefined();
      expect(out.Agent).toBeUndefined(); // still stripped
    });

    it('allowlist + denylist: allow wins, denylist can still remove', () => {
      const out = filterSubagentTools(allTools, def({
        tools: ['manifest_read', 'write_document'],
        disallowedTools: ['write_document'],
      }));
      expect(Object.keys(out)).toEqual(['manifest_read']);
    });

    it('returns empty object when nothing remains', () => {
      const out = filterSubagentTools(allTools, def({ tools: [] }));
      expect(out).toEqual({});
    });
  });
  ```

- [ ] **Step 2: Run to verify failure**

  Run: `npx vitest run src/lib/subagent/__tests__/filter.test.ts`
  Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

  ```ts
  // Filter buildToolSet's output according to a BuiltInAgentDefinition's
  // allow/deny lists. The Agent tool itself is ALWAYS stripped — subagents
  // cannot spawn further subagents regardless of config. This preserves the
  // §4 harness-boundary guarantee: buildToolSet is called unchanged; we
  // wrap its output here inside src/lib/subagent/.

  import type { Tool } from 'ai';
  import type { BuiltInAgentDefinition } from './types';

  const AGENT_TOOL_NAME = 'Agent';

  export function filterSubagentTools(
    fullToolset: Record<string, Tool>,
    def: BuiltInAgentDefinition,
  ): Record<string, Tool> {
    const allow = def.tools ? new Set(def.tools) : null;
    const deny = new Set(def.disallowedTools ?? []);
    deny.add(AGENT_TOOL_NAME);

    const out: Record<string, Tool> = {};
    for (const [name, tool] of Object.entries(fullToolset)) {
      if (allow && !allow.has(name)) continue;
      if (deny.has(name)) continue;
      out[name] = tool;
    }
    return out;
  }
  ```

- [ ] **Step 4: Run tests to verify pass**

  Run: `npx vitest run src/lib/subagent/__tests__/filter.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subagent/filter.ts src/lib/subagent/__tests__/filter.test.ts
  git commit -m "feat(subagent): filterSubagentTools with allow/deny + always-strip Agent"
  ```

---

## Task 10: `validateOutputContract`

**Files:**
- Create: `src/lib/subagent/validators.ts`
- Create: `src/lib/subagent/__tests__/validators.test.ts`

- [ ] **Step 1: Write the failing tests**

  ```ts
  import { describe, expect, it } from 'vitest';
  import { validateOutputContract } from '../validators';
  import type { OutputContract } from '../types';

  describe('validateOutputContract', () => {
    it('returns ok when no validator is present', () => {
      const contract: OutputContract = { type: 'freeform' };
      expect(validateOutputContract('any text', contract)).toEqual({ ok: true });
    });

    it('delegates to the custom validator', () => {
      const contract: OutputContract = {
        type: 'freeform',
        validator: (t) => (t.length > 0 ? { ok: true } : { ok: false, reason: 'empty' }),
      };
      expect(validateOutputContract('hello', contract)).toEqual({ ok: true });
      expect(validateOutputContract('', contract)).toEqual({ ok: false, reason: 'empty' });
    });
  });
  ```

- [ ] **Step 2: Run to verify failure**

  Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

  ```ts
  import type { OutputContract } from './types';

  export function validateOutputContract(
    text: string,
    contract: OutputContract,
  ): { ok: true } | { ok: false; reason: string } {
    if (!contract.validator) return { ok: true };
    return contract.validator(text);
  }
  ```

  Trivial now — the complexity lives in each agent's validator. Keep this thin so the dispatcher doesn't need to know about contract types.

- [ ] **Step 4: Run tests**

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subagent/validators.ts src/lib/subagent/__tests__/validators.test.ts
  git commit -m "feat(subagent): validateOutputContract passthrough"
  ```

---

## Task 11: Subagent registry

**Files:**
- Create: `src/lib/subagent/registry.ts`
- Create: `src/lib/subagent/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

  ```ts
  import { describe, expect, it } from 'vitest';
  import { getBuiltInAgents, getBuiltInAgent } from '../registry';

  describe('registry', () => {
    it('returns an array of BuiltInAgentDefinitions', () => {
      const agents = getBuiltInAgents();
      expect(Array.isArray(agents)).toBe(true);
    });

    it('each agent has a unique agentType', () => {
      const agents = getBuiltInAgents();
      const types = agents.map((a) => a.agentType);
      expect(new Set(types).size).toBe(types.length);
    });

    it('getBuiltInAgent returns undefined for unknown types', () => {
      expect(getBuiltInAgent('NoSuchAgent')).toBeUndefined();
    });

    // BrainExplore registration is asserted in Task 13's brainExploreAgent.test.ts.
  });
  ```

- [ ] **Step 2: Run to verify failure**

  Expected: FAIL.

- [ ] **Step 3: Implement — empty registry first**

  ```ts
  import type { BuiltInAgentDefinition } from './types';

  // Built-in agents registered here. Add new built-ins by importing the
  // definition from ./built-in/<slug>Agent.ts and pushing into this array.
  // Order affects the Agent tool description rendering — most-used first.
  const BUILT_IN_AGENTS: BuiltInAgentDefinition[] = [
    // BRAIN_EXPLORE_AGENT registered in Task 13.
  ];

  export function getBuiltInAgents(): BuiltInAgentDefinition[] {
    return [...BUILT_IN_AGENTS];
  }

  export function getBuiltInAgent(
    agentType: string,
  ): BuiltInAgentDefinition | undefined {
    return BUILT_IN_AGENTS.find((a) => a.agentType === agentType);
  }
  ```

- [ ] **Step 4: Run tests**

  Expected: PASS (array-based tests; BrainExplore-specific tests land in Task 13).

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subagent/registry.ts src/lib/subagent/__tests__/registry.test.ts
  git commit -m "feat(subagent): empty built-in registry + lookup"
  ```

---

## Task 12: `runSubagent` dispatcher

**Files:**
- Create: `src/lib/subagent/runSubagent.ts`
- Create: `src/lib/subagent/__tests__/runSubagent.test.ts`

This is the biggest task. Break into multiple sub-steps with interim commits.

- [ ] **Step 1: Write failing test for the "unknown agent type" path first**

  ```ts
  import { describe, expect, it, vi } from 'vitest';
  import { runSubagent } from '../runSubagent';
  import type { AgentContext } from '@/lib/agent/types';

  const minimalParentCtx: AgentContext = {
    actor: { type: 'platform_agent', userId: 'u1', companyId: 'c1', scopes: ['read'] },
    brainId: 'b1',
    companyId: 'c1',
    sessionId: 's1',
    abortSignal: new AbortController().signal,
    grantedCapabilities: [],
  };

  describe('runSubagent — error paths', () => {
    it('returns {ok:false, error} for unknown subagent_type', async () => {
      const result = await runSubagent(
        { parentCtx: minimalParentCtx, parentUsageRecordId: null },
        { description: 'test', subagent_type: 'NoSuchAgent', prompt: 'hi' },
      );
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining('Unknown subagent_type'),
      });
    });
  });
  ```

- [ ] **Step 2: Run to verify failure**

  Expected: FAIL — module not found.

- [ ] **Step 3: Implement skeleton that handles unknown type**

  ```ts
  import type {
    SubagentDispatchContext,
    SubagentInvocation,
    SubagentResult,
  } from './types';
  import { getBuiltInAgent, getBuiltInAgents } from './registry';

  export async function runSubagent(
    dispatchCtx: SubagentDispatchContext,
    invocation: SubagentInvocation,
  ): Promise<SubagentResult> {
    const def = getBuiltInAgent(invocation.subagent_type);
    if (!def) {
      const available = getBuiltInAgents().map((a) => a.agentType).join(', ');
      return {
        ok: false,
        error: `Unknown subagent_type: ${invocation.subagent_type}. Available: ${available || 'none'}`,
      };
    }
    // TODO: subsequent steps flesh out the dispatch flow.
    throw new Error('not implemented');
  }
  ```

- [ ] **Step 4: Run tests — unknown-type test passes, others still fail (not implemented)**

  Expected: unknown-type PASS.

- [ ] **Step 5: Add more tests covering the happy path with `runAgentTurn` mocked**

  ```ts
  // At top of the test file, set up a mock for runAgentTurn that returns
  // a canned result. This lets us assert on the dispatch glue without
  // actually calling an LLM.
  vi.mock('@/lib/agent/run', () => ({
    runAgentTurn: vi.fn(),
    DEFAULT_MODEL: 'claude-sonnet-4.6',
  }));

  vi.mock('@/lib/agent/tool-bridge', () => ({
    buildToolSet: vi.fn().mockReturnValue({
      manifest_read: {},
      search_documents: {},
      write_document: {},
      Agent: {},
    }),
  }));

  vi.mock('@/lib/agent/hooks', () => ({
    runHook: vi.fn().mockResolvedValue({ decision: 'allow' }),
  }));

  // Register a fake agent via the registry's internal array, or
  // stub getBuiltInAgent to return a fixture. Prefer the stub so
  // tests don't pollute the real registry.
  vi.mock('../registry', () => ({
    getBuiltInAgent: vi.fn(),
    getBuiltInAgents: vi.fn().mockReturnValue([]),
  }));
  ```

  Then tests for:
  - Happy path: valid type → runAgentTurn called with fresh sessionId (null), filtered tools (no `write_document`, no `Agent`), correct system prompt, returns `{ok:true, text, usage}`.
  - `omitBrainContext: true` passed through to runAgentTurn call options.
  - `model: 'inherit'` vs concrete model ID both resolve correctly.
  - `maxTurns` threaded to `runAgentTurn` params.
  - Abort signal inherited from parent.
  - `SubagentStart` hook fires with correct payload.
  - `outputContract.validator` failure → `{ok:false, error, partialText}`.
  - `usage_records` + `subagent.invoked` audit event both written on success.
  - `usage_records` still written with partial counts when provider errors mid-stream; audit event fires with status `provider_error`.
  - Aborted call: audit event fires with status `aborted`.

  Write these one at a time (red → green → commit) rather than all at once.

- [ ] **Step 6: Flesh out runSubagent to satisfy the tests**

  Full implementation sketch:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { stepCountIs } from 'ai';
  import { filterSubagentTools } from './filter';
  import { validateOutputContract } from './validators';
  import { resolveModel } from '@/lib/models/resolve';
  import { runAgentTurn, DEFAULT_MODEL } from '@/lib/agent/run';
  import { buildToolSet } from '@/lib/agent/tool-bridge';
  import { runHook } from '@/lib/agent/hooks';
  import { logEvent } from '@/lib/audit/logger';
  import { recordUsage } from '@/lib/usage/record';
  import type { AgentContext } from '@/lib/agent/types';

  export async function runSubagent(
    dispatchCtx: SubagentDispatchContext,
    invocation: SubagentInvocation,
  ): Promise<SubagentResult> {
    const { parentCtx, parentUsageRecordId } = dispatchCtx;
    const def = getBuiltInAgent(invocation.subagent_type);
    if (!def) {
      await emitUnknownTypeAudit(parentCtx, invocation, parentUsageRecordId);
      const available = getBuiltInAgents().map((a) => a.agentType).join(', ');
      return {
        ok: false,
        error: `Unknown subagent_type: ${invocation.subagent_type}. Available: ${available || 'none'}`,
      };
    }

    // Build subagent context: fresh session, preserve parent's actor type.
    // We do NOT coerce to 'platform_agent' — that would lose the parent's
    // semantic actor (e.g. 'maintenance_agent') in audit events. The spec §11
    // open question #3 keeps the pilot at the parent's type for simplicity;
    // introducing a distinct 'subagent' actor type is a follow-up.
    const subCtx: AgentContext = {
      actor: parentCtx.actor,
      brainId: parentCtx.brainId,
      companyId: parentCtx.companyId,
      sessionId: null,
      agentDefinitionId: `builtin:${def.agentType}`,
      abortSignal: parentCtx.abortSignal,
      grantedCapabilities: parentCtx.grantedCapabilities,
    };

    // Build & filter toolset. buildToolSet takes a ToolContext (defined in
    // src/lib/tools/types.ts) — different shape than AgentContext. The chat
    // route at src/app/api/agent/chat/route.ts:302 does the same translation.
    // Keep this mapping in sync with the chat route.
    const toolCtx = {
      actor: {
        type: parentCtx.actor.type,
        id: parentCtx.actor.userId ?? 'subagent',
        scopes: parentCtx.actor.scopes,
      },
      companyId: parentCtx.companyId,
      brainId: parentCtx.brainId,
      sessionId: parentCtx.sessionId ?? undefined,
      abortSignal: parentCtx.abortSignal,
      grantedCapabilities: parentCtx.grantedCapabilities,
      agentSkillIds: [],
      webCallsThisTurn: 0,
    };
    const fullToolset = buildToolSet(toolCtx, {}, {});
    const tools = filterSubagentTools(fullToolset, def);

    // Fire SubagentStart hook.
    const parentTurnId = randomUUID(); // or thread through from parent
    const hookDecision = await runHook({
      name: 'SubagentStart',
      ctx: subCtx,
      subagentType: def.agentType,
      parentTurnId,
    });
    if (hookDecision.decision === 'deny') {
      return { ok: false, error: `Hook denied: ${hookDecision.reason}` };
    }

    // Resolve model.
    const model = def.model === 'inherit'
      ? /* parent's model handle; requires parent to thread its model in — for pilot use DEFAULT_MODEL fallback */
        resolveModel(def.agentType, 'anthropic/claude-sonnet-4.6' as const)
      : resolveModel(def.agentType, def.model);

    // Dispatch via runAgentTurn.
    let result: Awaited<ReturnType<typeof runAgentTurn>> | null = null;
    let status: 'ok' | 'validator_failed' | 'max_turns' | 'aborted' | 'provider_error' = 'ok';
    let text = '';
    let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 };

    try {
      result = await runAgentTurn({
        ctx: subCtx,
        system: def.getSystemPrompt(),
        messages: [{ role: 'user', content: invocation.prompt }],
        tools,
        // AI SDK v6 idiom. Task 12.5 extends runAgentTurn's signature
        // to accept `stopWhen` directly (replacing the legacy maxSteps
        // wrapper param) so the harness passes it through to streamText
        // unchanged. Import stepCountIs from 'ai'.
        stopWhen: stepCountIs(def.maxTurns ?? 15),
        // model threading requires a small extension to runAgentTurn's model? param;
        // or resolve via resolveModel() and pass through. See adapter approach below.
      });
      // Drain events to collect final text + usage.
      for await (const evt of result.events) {
        if (evt.type === 'llm_delta') text += evt.delta;
        if (evt.type === 'turn_complete') {
          usage = {
            inputTokens: evt.usage.inputTokens,
            outputTokens: evt.usage.outputTokens,
            totalTokens: evt.usage.totalTokens,
            cachedInputTokens: evt.usage.cachedInputTokens ?? 0,
          };
          if (evt.finishReason === 'aborted') status = 'aborted';
        }
      }
    } catch (err) {
      status = 'provider_error';
    }

    // Always write usage_records if tokens were consumed.
    let usageRecordId: string | null = null;
    if (usage.totalTokens > 0) {
      const row = await recordUsage({
        companyId: subCtx.companyId,
        sessionId: null,
        userId: subCtx.actor.userId,
        modelId: def.model === 'inherit' ? DEFAULT_MODEL : def.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
        source: 'subagent',
        parentUsageRecordId,
      });
      usageRecordId = row?.id ?? null;
    }

    // Validate output contract (only if the call otherwise succeeded).
    if (status === 'ok' && def.outputContract) {
      const v = validateOutputContract(text, def.outputContract);
      if (!v.ok) {
        status = 'validator_failed';
        await emitAuditEvent(subCtx, def, status, parentUsageRecordId, usageRecordId, v.reason);
        return { ok: false, error: v.reason, partialText: text };
      }
    }

    // Emit audit event with the final status.
    await emitAuditEvent(subCtx, def, status, parentUsageRecordId, usageRecordId);

    if (status !== 'ok') {
      return { ok: false, error: `Subagent finished with status=${status}`, partialText: text };
    }
    return { ok: true, text, usage, subagentType: def.agentType };
  }
  ```

  **Model threading note:** `runAgentTurn` currently takes `model?: string` and constructs the Anthropic instance internally. Since the pilot uses the Gateway via `resolveModel`, we have two options:
  1. **Preferred:** extend `RunAgentTurnParams` to accept a `LanguageModel` handle directly (not a string). This keeps `src/lib/agent/run.ts` provider-agnostic. Make this change inside `runAgentTurn` itself in a tiny supplementary task below (Task 12.5) because it touches the harness.
  2. **Fallback:** leave `run.ts` alone and have `runSubagent` call `streamText` itself — but this violates the "only `run.ts` imports `streamText`" rule.

  Option 1 is the correct move. See Task 12.5.

- [ ] **Step 7: Run all runSubagent tests**

  Expected: PASS.

- [ ] **Step 8: Commit**

  ```bash
  git add src/lib/subagent/runSubagent.ts src/lib/subagent/__tests__/runSubagent.test.ts
  git commit -m "feat(subagent): runSubagent dispatcher with validator + audit + usage attribution"
  ```

---

## Task 12.5: Extend `runAgentTurn` — `modelHandle` + `stopWhen`

**Rationale:** Two small additive changes to the harness so `runSubagent` can call it correctly without duplicating `streamText`:

1. **`modelHandle?: LanguageModel`** — route subagents through the Gateway without the harness importing `@ai-sdk/gateway`. Takes precedence over the existing string-based `model` param.
2. **`stopWhen?: Parameters<typeof streamText>[0]['stopWhen']`** — AI SDK v6 replaced `maxSteps` with `stopWhen: stepCountIs(N)`. The existing `maxSteps?: number` wrapper param predates this; add `stopWhen` as a first-class passthrough alongside it (translate `maxSteps` to `stopWhen` only when `stopWhen` is absent, for backward compat with the chat route). Subagents always supply `stopWhen: stepCountIs(...)` directly.

**Files:**
- Modify: `src/lib/agent/run.ts`
- Modify or create: `src/lib/agent/__tests__/run.test.ts` (create if missing — follow Vitest conventions used in other `__tests__/` dirs in this repo)

- [ ] **Step 1: Write the failing test**

  Assert that when `modelHandle` is supplied, `run.ts` uses it instead of constructing an Anthropic instance. Mock `streamText` to inspect the `model` arg it receives. Additionally, assert that when `stopWhen` is supplied it takes precedence over `maxSteps`.

- [ ] **Step 2: Run to verify failure**

  Expected: FAIL.

- [ ] **Step 3: Extend the params type and logic**

  ```ts
  import { stepCountIs, streamText, type LanguageModel } from 'ai';

  // Derive the stopWhen shape from streamText itself — the exported
  // public type name has varied across v6 minor versions, so take it
  // off the function signature directly.
  type StreamTextStopWhen = NonNullable<Parameters<typeof streamText>[0]['stopWhen']>;

  interface RunAgentTurnParams {
    // ... existing fields ...
    model?: string;
    /**
     * Pre-resolved model handle. Takes precedence over `model`. Used by the
     * subagent layer to route via the Vercel AI Gateway without this file
     * needing to know about the gateway.
     */
    modelHandle?: LanguageModel;
    /**
     * AI SDK v6 step-cap. Takes precedence over `maxSteps`. Supply as
     * `stopWhen: stepCountIs(N)` from caller.
     */
    stopWhen?: StreamTextStopWhen;
  }

  // Inside the function:
  const resolvedModel = params.modelHandle ?? anthropic(params.model ?? DEFAULT_MODEL);
  const resolvedStopWhen: StreamTextStopWhen | undefined =
    params.stopWhen ??
    (params.maxSteps !== undefined ? stepCountIs(params.maxSteps) : undefined);
  // ... pass resolvedModel + resolvedStopWhen to streamText
  ```

- [ ] **Step 4: Run existing + new tests**

  Expected: PASS. Existing call-sites (chat route) still work because `modelHandle` is optional.

- [ ] **Step 5: Lint + boundary check**

  ```bash
  npm run lint
  ```
  Expected: the harness-boundary script still passes (we added a type import from `ai` which is already allowed).

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/agent/run.ts src/lib/agent/__tests__/
  git commit -m "feat(agent): accept pre-resolved modelHandle for gateway-routed callers"
  ```

---

## Task 13: BrainExplore agent definition

**Files:**
- Create: `src/lib/subagent/built-in/brainExploreAgent.ts`
- Modify: `src/lib/subagent/registry.ts` — register `BRAIN_EXPLORE_AGENT`
- Create: `src/lib/subagent/__tests__/brainExplore.test.ts`

- [ ] **Step 1: Write failing tests for the validator**

  ```ts
  import { describe, expect, it } from 'vitest';
  import { BRAIN_EXPLORE_AGENT } from '../built-in/brainExploreAgent';

  const validator = BRAIN_EXPLORE_AGENT.outputContract!.validator!;

  describe('BRAIN_EXPLORE_AGENT validator', () => {
    it('accepts properly formatted Sources block', () => {
      const txt = `
  1. Answer: short answer.

  2. Sources
     - Pricing Runbook — slug: \`pricing-runbook\` — id: \`uuid-1\`
     - Onboarding Checklist — slug: \`onboarding\` — id: \`uuid-2\`
  `;
      expect(validator(txt)).toEqual({ ok: true });
    });

    it('rejects a Sources bullet missing slug', () => {
      const txt = `
  2. Sources
     - Foo — id: \`uuid-1\`
  `;
      expect(validator(txt).ok).toBe(false);
    });

    it('rejects a Sources bullet missing id', () => {
      const txt = `
  2. Sources
     - Foo — slug: \`foo\`
  `;
      expect(validator(txt).ok).toBe(false);
    });

    it('does not false-positive on prose mentioning slug or id outside Sources', () => {
      const txt = `
  1. Answer: Use id fields for referencing. Every doc has a slug.

  2. Sources
     - Foo — slug: \`foo\` — id: \`uuid-1\`
  `;
      expect(validator(txt)).toEqual({ ok: true });
    });

    it('rejects when no Sources section is present', () => {
      expect(validator('1. Answer: hi').ok).toBe(false);
    });
  });

  describe('BRAIN_EXPLORE_AGENT config', () => {
    it('uses Haiku 4.5 as default', () => {
      expect(BRAIN_EXPLORE_AGENT.model).toBe('anthropic/claude-haiku-4.5');
    });
    it('denies write tools', () => {
      expect(BRAIN_EXPLORE_AGENT.disallowedTools).toEqual(
        expect.arrayContaining(['write_document', 'update_frontmatter', 'delete_document', 'create_document', 'Agent']),
      );
    });
    it('omits brain context', () => {
      expect(BRAIN_EXPLORE_AGENT.omitBrainContext).toBe(true);
    });
    it('sets maxTurns for 200+ doc brains', () => {
      expect(BRAIN_EXPLORE_AGENT.maxTurns).toBe(30);
    });
  });
  ```

- [ ] **Step 2: Run to verify failure**

  Expected: FAIL.

- [ ] **Step 3: Implement the agent definition**

  ```ts
  import type { BuiltInAgentDefinition } from '../types';

  const SYSTEM_PROMPT = `You are a brain navigation specialist for Tatara. You excel at finding documents, understanding the manifest, and synthesizing answers from a company's brain (their markdown knowledge base).

  === READ-ONLY MODE — NO WRITES ===
  You cannot write, update, or delete documents. Your tools are strictly read-only:
  - manifest_read — the full category + document index
  - search_documents — keyword search across document titles, frontmatter, and content
  - get_document — retrieve a document by id or slug
  - get_frontmatter — retrieve just a document's frontmatter (cheap, use this when you don't need the body)

  === YOUR STRENGTHS ===
  - Rapidly finding documents via search_documents
  - Starting broad (manifest) and narrowing to specific documents
  - Synthesizing multi-document answers

  === GUIDELINES ===
  - Start with manifest_read to orient yourself unless the caller's prompt points you at a specific document
  - For "do we have anything on X": search_documents with multiple query variations (X, synonyms, related terms)
  - For "what's our current position on X": get_document on the most authoritative match, check the manifest category and status frontmatter
  - Parallelize: when you have 3-4 candidate documents to read, call get_document 3-4 times in a single message
  - Thoroughness levels (caller will specify in the prompt):
    - "quick": 1-2 searches, max 3 document reads
    - "medium": 2-3 searches, 3-5 document reads
    - "very thorough": broad search, read every plausible document, check related categories

  === OUTPUT (REQUIRED FORMAT) ===
  Your final message MUST follow this structure exactly. The caller parses the Sources list programmatically — deviations break downstream tooling.

  1. **Answer** — 1-3 sentences directly answering the caller's question.

  2. **Sources** — a bulleted list of EVERY document you consulted. Each line MUST include both the slug AND the document id. Format:
     - <document title> — slug: \`<slug>\` — id: \`<document-id>\`

     Do not omit either field. If you only have the slug, call get_document first to retrieve the id (and vice versa) before finalizing your reply. A source without both slug and id is rejected.

  3. **Gaps** (optional) — what the brain did not have that you expected to find. Omit the section entirely if nothing applies.

  Do NOT paste full document contents. Do NOT paraphrase a document as a substitute for citing its slug+id — the caller retrieves the source themselves when it needs the full text.

  Complete the caller's task efficiently and report clearly.`;

  // Validator regex: matches bullet lines of shape
  //   - <anything> — slug: `<slug>` — id: `<id>`
  // where <slug> and <id> are backtick-wrapped non-backtick runs.
  //
  // The em-dash separator is U+2014 (not two hyphens). Do not replace
  // with "--" when copy-pasting — the system prompt and validator must
  // agree on the exact character.
  const SOURCES_LINE_RE = /^- .+ — slug: `[^`]+` — id: `[^`]+`$/;

  function extractSourcesBlock(text: string): string[] | null {
    // Find the Sources section heading (matches "## Sources", "**Sources**",
    // "2. **Sources**", "2. Sources"). Capture everything until the next
    // numbered section or end-of-input.
    const m = text.match(/(?:^|\n)\s*(?:\d+\.\s*)?(?:\*\*)?Sources(?:\*\*)?[^\n]*\n([\s\S]*?)(?=\n\s*(?:\d+\.\s*)?(?:\*\*)?(?:Gaps|Answer)|$)/i);
    if (!m) return null;
    return m[1]!.split('\n');
  }

  export const BRAIN_EXPLORE_AGENT: BuiltInAgentDefinition = {
    agentType: 'BrainExplore',
    whenToUse:
      'Fast agent for navigating the brain — manifest, documents, frontmatter. Use when you need to find documents by topic, check what exists on a subject, or synthesize answers across multiple documents. Specify thoroughness: "quick" (1-2 searches), "medium" (default), or "very thorough" (comprehensive).',
    model: 'anthropic/claude-haiku-4.5',
    disallowedTools: [
      'write_document',
      'update_frontmatter',
      'delete_document',
      'create_document',
      'Agent',
    ],
    omitBrainContext: true,
    maxTurns: 30,
    getSystemPrompt: () => SYSTEM_PROMPT,
    outputContract: {
      type: 'freeform',
      validator: (text) => {
        const lines = extractSourcesBlock(text);
        if (!lines) {
          return { ok: false, reason: 'Missing Sources section' };
        }
        const bullets = lines
          .map((l) => l.trim())
          .filter((l) => l.startsWith('-'));
        if (bullets.length === 0) {
          return { ok: false, reason: 'Sources section is empty' };
        }
        const bad = bullets.filter((l) => !SOURCES_LINE_RE.test(l));
        if (bad.length > 0) {
          return {
            ok: false,
            reason: `Source line(s) missing slug or id: ${bad.join(' | ')}`,
          };
        }
        return { ok: true };
      },
    },
  };
  ```

- [ ] **Step 4: Register in the registry**

  In `src/lib/subagent/registry.ts`:
  ```ts
  import { BRAIN_EXPLORE_AGENT } from './built-in/brainExploreAgent';

  const BUILT_IN_AGENTS: BuiltInAgentDefinition[] = [
    BRAIN_EXPLORE_AGENT,
  ];
  ```

- [ ] **Step 5: Run all subagent tests**

  ```bash
  npx vitest run src/lib/subagent
  ```
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/subagent/
  git commit -m "feat(subagent): BrainExplore built-in agent with Sources validator"
  ```

---

## Task 14: `prompt.ts` — dynamic Agent-tool description

**Files:**
- Create: `src/lib/subagent/prompt.ts`
- Create: `src/lib/subagent/__tests__/prompt.test.ts`

- [ ] **Step 1: Write failing tests**

  ```ts
  import { describe, expect, it } from 'vitest';
  import { buildAgentToolDescription } from '../prompt';
  import type { BuiltInAgentDefinition } from '../types';

  const def = (overrides: Partial<BuiltInAgentDefinition>) =>
    ({
      agentType: 'X',
      whenToUse: 'x purpose',
      model: 'anthropic/claude-haiku-4.5',
      getSystemPrompt: () => '',
      ...overrides,
    } as BuiltInAgentDefinition);

  describe('buildAgentToolDescription', () => {
    it('renders "no agents registered" when empty', () => {
      const desc = buildAgentToolDescription([]);
      expect(desc).toContain('no agents are currently registered');
    });

    it('lists each agent with its whenToUse and tool description', () => {
      const desc = buildAgentToolDescription([
        def({ agentType: 'BrainExplore', whenToUse: 'find docs', disallowedTools: ['write_document', 'Agent'] }),
      ]);
      expect(desc).toContain('BrainExplore');
      expect(desc).toContain('find docs');
      expect(desc).toMatch(/All tools except.*write_document/);
    });

    it('renders an allowlist explicitly', () => {
      const desc = buildAgentToolDescription([
        def({ agentType: 'Y', tools: ['manifest_read', 'search_documents'] }),
      ]);
      expect(desc).toContain('Tools: manifest_read, search_documents');
    });
  });
  ```

- [ ] **Step 2: Run to verify failure**

  Expected: FAIL.

- [ ] **Step 3: Implement**

  Pattern mirrors claude-code's `formatAgentLine` — see `C:/Code/claude-code/src/tools/AgentTool/prompt.ts:43`.

  ```ts
  import type { BuiltInAgentDefinition } from './types';

  function formatToolsDescription(def: BuiltInAgentDefinition): string {
    if (def.tools && def.tools.length > 0) {
      return `Tools: ${def.tools.join(', ')}`;
    }
    if (def.disallowedTools && def.disallowedTools.length > 0) {
      return `All tools except ${def.disallowedTools.join(', ')}`;
    }
    return 'All tools';
  }

  function formatAgentLine(def: BuiltInAgentDefinition): string {
    return `- ${def.agentType}: ${def.whenToUse} (${formatToolsDescription(def)})`;
  }

  export function buildAgentToolDescription(
    agents: BuiltInAgentDefinition[],
  ): string {
    const listing = agents.length === 0
      ? '_(no agents are currently registered)_'
      : agents.map(formatAgentLine).join('\n');

    return `Launch a new agent to handle complex, multi-step tasks autonomously.

  The Agent tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

  Available agent types and the tools they have access to:
  ${listing}

  When using the Agent tool, specify a subagent_type parameter to select which agent type to use.

  Usage notes:
  - Always include a short description (3-5 words) summarizing what the agent will do
  - The subagent starts fresh — brief it like a colleague who hasn't seen this conversation
  - Subagent output is not visible to the user; summarize its findings in your own reply
  - Launch multiple agents concurrently when tasks are independent — single message, multiple tool calls

  Writing the prompt:
  - Explain what you're trying to accomplish and why
  - Describe what you've already learned or ruled out
  - If you need a short response, say so ("report in under 200 words")
  - Never delegate understanding — include document slugs, doc ids, and specifics rather than pushing synthesis onto the subagent`;
  }
  ```

- [ ] **Step 4: Run tests**

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subagent/prompt.ts src/lib/subagent/__tests__/prompt.test.ts
  git commit -m "feat(subagent): dynamic Agent tool description builder"
  ```

---

## Task 15: `AgentTool` — the dispatch tool exposed to parent

**Files:**
- Create: `src/lib/subagent/AgentTool.ts`
- Create: `src/lib/subagent/__tests__/AgentTool.test.ts`

- [ ] **Step 1: Write failing tests**

  ```ts
  describe('buildAgentTool', () => {
    it('Zod schema accepts valid calls', () => { /* parse success */ });
    it('rejects empty prompt', () => { /* parse throws */ });
    it('rejects description shorter than 3 chars', () => { /* parse throws */ });
    it('returns structured error for unknown subagent_type at execute time', async () => { /* ... */ });
    it('enforces per-parent-turn cap (default 10)', async () => {
      // Call tool.execute 11 times with the same parent ctx; 11th returns cap error.
    });
    it('allows concurrent calls below the cap', async () => { /* ... */ });
  });
  ```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement**

  ```ts
  import { tool } from 'ai';
  import { z } from 'zod';
  import { runSubagent } from './runSubagent';
  import type { AgentContext } from '@/lib/agent/types';

  const DEFAULT_CAP = Number(process.env.TATARA_MAX_SUBAGENTS_PER_TURN ?? '10');

  export interface BuildAgentToolOptions {
    parentCtx: AgentContext;
    /**
     * Getter for the parent's usage_records.id. Usage is inserted inside
     * the parent's onFinish callback, AFTER the tool's execute has already
     * run — so the subagent calls see `null` on the first read. The getter
     * lets the caller's closure-captured ref flip once the parent id lands,
     * attributing any subsequent subagent calls in the same turn. The pilot
     * accepts the partial attribution (first subagent call has a null FK)
     * in exchange for avoiding a two-phase write.
     */
    getParentUsageRecordId: () => string | null;
    /** The Agent tool description. Supply `buildAgentToolDescription(getBuiltInAgents())` from the caller. */
    description: string;
    /** Mutable counter shared across the Agent tool's lifetime for this parent turn. */
    cap?: { limit: number; count: number };
  }

  export function buildAgentTool(opts: BuildAgentToolOptions) {
    const cap = opts.cap ?? { limit: DEFAULT_CAP, count: 0 };
    return tool({
      description: opts.description,
      inputSchema: z.object({
        description: z.string().min(3).max(60),
        subagent_type: z.string(),
        prompt: z.string().min(1),
      }),
      execute: async (input) => {
        if (cap.count >= cap.limit) {
          return {
            ok: false,
            error: `Subagent cap of ${cap.limit}/turn reached. No further subagent calls in this turn.`,
          };
        }
        cap.count += 1;
        return runSubagent(
          {
            parentCtx: opts.parentCtx,
            parentUsageRecordId: opts.getParentUsageRecordId(),
          },
          input,
        );
      },
    });
  }
  ```

  **Note:** the description is passed in as an option, not set via property mutation. The AI SDK's `tool()` captures the description at construction time; later mutation would not be read. The caller composes `buildAgentToolDescription(getBuiltInAgents())` and hands the result in.

- [ ] **Step 4: Run tests**

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subagent/AgentTool.ts src/lib/subagent/__tests__/AgentTool.test.ts
  git commit -m "feat(subagent): Agent dispatch tool with per-turn cap"
  ```

---

## Task 16: Wire into the chat route behind a feature flag

**Files:**
- Modify: `src/app/api/agent/chat/route.ts`
- Modify: `src/app/api/agent/chat/__tests__/route.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing test in `route.test.ts`**

  Assert: when `TATARA_SUBAGENTS_ENABLED=true`, the tool set handed to `runAgentTurn` contains an `Agent` key. When unset/false, it does not.

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Wire it up**

  ```ts
  // src/app/api/agent/chat/route.ts, near the buildToolSet call
  import type { Tool } from 'ai';
  import { buildAgentTool } from '@/lib/subagent/AgentTool';
  import { buildAgentToolDescription } from '@/lib/subagent/prompt';
  import { getBuiltInAgents } from '@/lib/subagent/registry';

  // Inside the route handler, BEFORE constructing the tool set:
  const subagentsEnabled = process.env.TATARA_SUBAGENTS_ENABLED === 'true';

  // Closure-captured parent usage-record id. Starts null; onFinish flips
  // it once the parent's usage_records row is inserted. Any subagent
  // calls made after that point in the same turn attribute correctly.
  // The first subagent call in a turn accepts null — see Task 15 note.
  const parentUsageRecordRef: { id: string | null } = { id: null };
  const parentTurnCap = { limit: Number(process.env.TATARA_MAX_SUBAGENTS_PER_TURN ?? '10'), count: 0 };

  const externalTools: Record<string, Tool> = { ...mcpOutTools };
  if (subagentsEnabled) {
    externalTools.Agent = buildAgentTool({
      parentCtx,
      getParentUsageRecordId: () => parentUsageRecordRef.id,
      description: buildAgentToolDescription(getBuiltInAgents()),
      cap: parentTurnCap,
    });
  }
  // Pass externalTools into buildToolSet(ctx, externalTools, externalToolMeta).

  // ... inside the existing onFinish callback, after `await recordUsage(...)`:
  // Capture the inserted row's id so any remaining subagent calls in the
  // same turn can attribute to it. (Requires Task 6's recordUsage return
  // shape { id } | null.)
  const row = await recordUsage({ /* existing args */ });
  if (row) parentUsageRecordRef.id = row.id;
  ```

  **Parent usage-record threading:** The closure-captured ref is the clean pattern. The first subagent call in a turn runs BEFORE `onFinish` has fired (the parent's own tokens aren't counted yet), so its `parentUsageRecordId` is `null` — documented as a known pilot limitation. Subsequent calls in the same turn (after the parent's `onFinish` writes its row) attribute correctly. Full fix requires a two-phase write (allocate parent id pre-stream, backfill totals post-stream) — tracked as a follow-up, not pilot scope.

- [ ] **Step 4: Run tests**

  ```bash
  npx vitest run src/app/api/agent/chat
  ```
  Expected: PASS (flag on → Agent present; flag off → absent).

- [ ] **Step 5: Document the env vars**

  In `.env.example`:
  ```
  # Subagent harness
  TATARA_SUBAGENTS_ENABLED=false
  TATARA_MAX_SUBAGENTS_PER_TURN=10
  # TATARA_MODEL_OVERRIDE_<AGENT_SLUG>=<ApprovedModelId>
  # Example:
  # TATARA_MODEL_OVERRIDE_BRAIN_EXPLORE=google/gemini-2.5-flash-lite
  ```

- [ ] **Step 6: Lint + type-check**

  ```bash
  npm run lint
  npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/app/api/agent/chat/ .env.example
  git commit -m "feat(chat): wire Agent dispatch tool behind TATARA_SUBAGENTS_ENABLED"
  ```

---

## Task 16.5: Document and enforce `src/lib/subagent/` boundary

`AGENTS.md` lists forbidden imports inside `src/lib/agent/`. Task 12.5 adds a `LanguageModel` type import from `ai` (already allowed). But the harness must ALSO never import from `src/lib/subagent/` — that would create the reverse-dependency cycle the spec §4 explicitly prohibits.

**Files:**
- Modify: `C:/code/locus/locus-web/AGENTS.md`
- Modify: `scripts/check-harness-boundary.sh`
- Modify: `eslint.config.mjs` (if `no-restricted-imports` is configured there)

- [ ] **Step 1: Extend AGENTS.md**

  Under the existing forbidden-imports list for `src/lib/agent/`, add:
  ```md
  - `@/lib/subagent/*` — the subagent dispatch layer depends on the
    harness, never the reverse. A harness that reaches into the subagent
    layer creates a cycle and breaks the ability to call the harness from
    contexts that don't have subagents wired up (e.g. the autonomous loop
    in Phase 2).
  ```

- [ ] **Step 2: Extend `scripts/check-harness-boundary.sh`**

  Add a grep line mirroring the existing ones:
  ```bash
  if grep -RnE "from ['\"]@/lib/subagent" src/lib/agent/ >/dev/null 2>&1; then
    echo "ERROR: src/lib/agent/ must not import from src/lib/subagent/"
    exit 1
  fi
  ```

- [ ] **Step 3: Extend `eslint.config.mjs` `no-restricted-imports` rule**

  Add `@/lib/subagent/*` and `../subagent/*` patterns to the existing `src/lib/agent/**/*.ts` override.

- [ ] **Step 4: Run the boundary check**

  ```bash
  npm run lint
  ```
  Expected: PASS (no offending imports yet).

- [ ] **Step 5: Commit**

  ```bash
  git add AGENTS.md scripts/check-harness-boundary.sh eslint.config.mjs
  git commit -m "chore: forbid src/lib/subagent imports inside src/lib/agent"
  ```

---

## Task 17: Integration test — BrainExplore end-to-end

**Files:**
- Create: `src/lib/subagent/__tests__/brain-explore.integration.test.ts`

- [ ] **Step 1: Write the integration test**

  Uses the AI SDK's mock language model (`MockLanguageModelV2` from `ai/test` in v6; if the import path has moved in a minor version, check `node_modules/ai/dist/test/` or the current `@ai-sdk/provider-utils` exports). Returns a canned response that includes a well-formed Sources block. Assert:
  - `runSubagent` returns `{ ok: true, text, usage }`.
  - `text` contains the Sources block and matches the validator.
  - `usage_records` is written with `source: 'subagent'` and `parentUsageRecordId` populated.
  - `audit_events` has a row with category `'agent'`, event type `'subagent.invoked'`, details including `status: 'ok'`, subagent type, model id.

  Mock the DB inserts via the existing test doubles used by `record.test.ts` and `audit` tests. Reuse patterns.

- [ ] **Step 2: Run**

  ```bash
  npx vitest run src/lib/subagent/__tests__/brain-explore.integration.test.ts
  ```
  Expected: PASS.

- [ ] **Step 3: Add a second test for output-contract failure**

  `output-contract-failure.test.ts`: canned response has a malformed Sources bullet. Assert `{ ok: false, error: /slug or id/, partialText }` and audit status `'validator_failed'`.

- [ ] **Step 4: Run**

  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subagent/__tests__/brain-explore.integration.test.ts src/lib/subagent/__tests__/output-contract-failure.test.ts
  git commit -m "test(subagent): BrainExplore end-to-end with mocked model"
  ```

---

## Task 18: Parallel-spawn cap test

**Files:**
- Create: `src/lib/subagent/__tests__/parent-spawn-parallel.test.ts`

- [ ] **Step 1: Write the test**

  Construct an `Agent` tool with cap `{ limit: 3, count: 0 }` and call `execute` four times (with mocked `runSubagent`). Assert the first three succeed; the fourth returns `{ ok: false, error: /cap of 3/ }`.

- [ ] **Step 2: Run — expect PASS (no production code needed; cap is already implemented)**

  If FAIL, fix the cap logic.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/subagent/__tests__/parent-spawn-parallel.test.ts
  git commit -m "test(subagent): parent-turn subagent-cap enforcement"
  ```

---

## Task 19: Eval harness scaffolding (no real LLM calls in CI)

**Files:**
- Create: `src/lib/subagent/evals/brain-explore/README.md`
- Create: `src/lib/subagent/evals/brain-explore/golden-set.ts` (15-20 queries + expected slugs — stub with 3 and a TODO for the rest)
- Create: `src/lib/subagent/evals/brain-explore/runner.ts` (CLI with `--model=<id>` flag)
- Create: `src/lib/subagent/evals/brain-explore/__tests__/runner.test.ts` (tests the runner's metrics math, not the LLM)

- [ ] **Step 1: Scaffold README + stub golden set**

  Per the spec's §9.3. The golden set can start with 3 queries and be expanded; the runner is the load-bearing code.

- [ ] **Step 2: Implement the runner**

  CLI that:
  1. Parses `--model=<ApprovedModelId>` (defaults to BrainExplore's default).
  2. Constructs the model via `getModel(id)`.
  3. For each golden query, calls `runSubagent` with a seeded brain fixture.
  4. Computes metrics: source-slug completeness (set intersection / expected), format-validator pass rate, avg tool calls, avg latency.
  5. Writes `src/lib/subagent/evals/brain-explore/results/<ISO-date>.json`.

- [ ] **Step 3: Unit-test the metrics math**

  Test the set-intersection helper with a handful of cases. Not testing the LLM itself.

- [ ] **Step 4: Run**

  ```bash
  npx vitest run src/lib/subagent/evals/brain-explore/__tests__/runner.test.ts
  ```
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/subagent/evals/
  git commit -m "feat(subagent): eval harness scaffolding for BrainExplore"
  ```

---

## Task 20: Final verification

- [ ] **Step 1: Full test run**

  ```bash
  npx vitest run
  ```
  Expected: PASS.

- [ ] **Step 2: Lint + boundary check**

  ```bash
  npm run lint
  ```
  Expected: PASS. The harness-boundary grep guard confirms `src/lib/agent/` has no Next.js/Vercel imports and no imports from `src/lib/subagent/`.

- [ ] **Step 3: Type-check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 4: Manual smoke (optional, staging-only)**

  Deploy to staging with `TATARA_SUBAGENTS_ENABLED=true`, open a real chat session, ask a question that triggers the Agent tool, confirm the Sources block appears in the user-visible reply with real slugs + ids and `usage_records` has child rows with `parent_usage_record_id` populated. Rollout-gate per spec §10.

- [ ] **Step 5: Use `superpowers:finishing-a-development-branch`**

  Follow the branch-finishing workflow to decide between PR, merge, or cleanup.

---

## Notes for the implementer

- **TDD discipline:** every task above has the "write failing test → run fail → implement → run pass → commit" rhythm. Do not batch. Each commit should leave the tree green.
- **Harness boundary:** do not add Next.js/Vercel imports to `src/lib/agent/`. Task 12.5 adds one harness change (a new optional param) — keep it minimal.
- **Gateway BYOK local dev:**
  1. Run `vercel link` once if the project is not yet linked.
  2. Run `vercel env pull .env.local` to fetch the OIDC token and any env vars.
  3. The AI SDK auto-reads `VERCEL_OIDC_TOKEN` from the environment when calling Gateway-routed models — no extra code.
  4. In CI (where `VERCEL_OIDC_TOKEN` is absent), integration tests must mock `@ai-sdk/gateway` via Vitest's `vi.mock('@ai-sdk/gateway', () => ({ gateway: () => mockLanguageModel }))`. Add this pattern to `src/lib/subagent/__tests__/test-setup.ts` and reference it from each integration test that would otherwise hit the network.
- **Model threading:** the existing `runAgentTurn` takes `model: string`. Task 12.5 adds `modelHandle: LanguageModel`. Subagents always use `modelHandle` (routed via Gateway); the chat route continues using `model` (Anthropic direct) during the migration window.
- **Audit ordering rule (from spec §5.5):** `usage_records` write → audit event fire → return. If either DB write fails, log and continue — never throw. The subagent result is already determined by the time we hit the persistence path.
- **DO NOT touch:** the existing Platform Agent `run.ts` beyond Task 12.5. The migration of the Platform Agent to the Gateway is a separate follow-up.

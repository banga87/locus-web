# Subagent Harness (Pilot) — Design

**Date:** 2026-04-19
**Status:** Design complete, pending spec review
**Scope:** Infrastructure + BrainExplore pilot only. Other five agents in `locus-brain/design/agent-harness/11-built-in-agents.md`.
**Related docs:**
- `locus-brain/research/model-selection-analysis.md` — model picks per agent
- `locus-brain/design/agent-harness/11-built-in-agents.md` — full agent catalog (planned)
- Existing harness: `locus-web/src/lib/agent/` (`runAgentTurn`, hooks, tool-bridge)
- Existing user-defined agents: `locus-web/src/lib/agents/` (wizard + brain-doc frontmatter)

---

## 1. Problem

The Platform Agent today runs inside a single `runAgentTurn` call with a fixed toolset and one model (Anthropic Sonnet). Two constraints bite as we approach MVP:

1. **No delegation.** Every brain-navigation step burns Platform Agent context and turn budget. A single "what do we have on pricing?" question forces the main conversation to read manifest + multiple documents before answering.
2. **Single-provider lock-in.** All token spend is on Sonnet. The model-selection research shows ~10× cost deltas are available for read-only tasks (Haiku 4.5 / Gemini Flash-Lite) and retrieval-heavy tasks (Gemini 2.5 Pro for long-context contradiction hunting).

This spec builds the infrastructure to solve both, plus the first built-in agent (BrainExplore) that exercises the full stack.

## 2. Goals

- Add a platform-owned **built-in subagent** layer, mirroring Claude Code's `AgentTool` pattern.
- Introduce a **Vercel AI Gateway–backed model registry** (Anthropic + Google to start) with a compile-checked list of approved models and a per-agent env-override for eval. BYOK auth model — our Anthropic and Google keys are stored in Vercel's Gateway BYOK configuration (not in application env / code). Zero Gateway markup on tokens; existing provider billing relationships unchanged.
- Ship **BrainExplore** as the pilot subagent: read-only brain navigation, Haiku 4.5 default, structured output contract enforcing `slug` + `id` citations.
- Extend `usage_records` with `parent_usage_record_id` so subagent cost is attributable to the parent turn.
- Zero change to the existing `src/lib/agent/` harness boundary. The subagent layer calls `runAgentTurn` without modifying it.

## 3. Non-goals

- Building the other five agents (WebResearch, DocumentDrafter, DCPVerifier, ConnectorFetch, ChangeClassifier). Each gets its own follow-up spec.
- Background / async subagents. The `background` flag exists on the type but the dispatch tool is synchronous-only in the pilot.
- User-built subagents. User-defined agents remain brain documents via the wizard; this layer is platform-owned only.
- Nested subagent spawning. Subagents cannot spawn further subagents (the `Agent` tool is on the denylist of every built-in).
- Cross-agent evals (DCPVerifier A/B etc.). Eval harness here is scoped to BrainExplore.
- Streaming subagent partial output to the parent. The pilot returns a single final message.
- Dispatching user-defined agents (brain-document agents created via the wizard) through the `Agent` tool. The catalog doc describes an eventual resolver fall-through from built-in to user-defined — **the pilot is built-in-only**. Fall-through is a follow-up spec.

## 4. Architecture

```
src/lib/
  agent/                        ← existing harness, unchanged
    run.ts
    types.ts
    tool-bridge.ts
    hooks.ts
    system-prompt.ts

  models/                       ← NEW — provider registry
    registry.ts                 ← createProviderRegistry({ anthropic, google })
    approved-models.ts          ← APPROVED_MODELS + ApprovedModelId type
    resolve.ts                  ← resolveModel(agentSlug, defaultId) with env override

  subagent/                     ← NEW — dispatch layer ("AgentTool" equivalent)
    AgentTool.ts                ← the dispatch tool exposed to parent
    runSubagent.ts              ← spawns subagent turn via runAgentTurn
    prompt.ts                   ← builds dynamic Agent-tool description
    registry.ts                 ← getBuiltInAgent() / getBuiltInAgents()
    types.ts                    ← BuiltInAgentDefinition, SubagentResult
    built-in/
      brainExploreAgent.ts      ← pilot agent (mirrors claude-code exploreAgent.ts)
    __tests__/
    evals/
      brain-explore/
```

**Design principles:**

- **Harness stays platform-agnostic.** `src/lib/agent/` must not import anything from `src/lib/subagent/`. The dependency direction is one-way: `subagent/` calls `agent/`, never the reverse.
- **Prompts live inline in TS** (template literals in `getSystemPrompt()`). Matches claude-code; keeps one file per agent; interpolation of tool names and flags is native.
- **Model binding via string IDs** resolved through the AI SDK's `createProviderRegistry`. Agent definitions hold `ApprovedModelId` unions for compile-time safety without a custom provider abstraction.
- **Subagent runs in a fresh session** with no parent conversation history. Inherits `companyId` / `userId` for auth; never inherits messages or tool context. Matches claude-code's "spawn" semantic (not "fork").

## 5. Components

### 5.1 Model registry

**`src/lib/models/approved-models.ts`**

```ts
export const APPROVED_MODELS = [
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.7',
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
] as const;

export type ApprovedModelId = (typeof APPROVED_MODELS)[number];

export function isApprovedModelId(value: string): value is ApprovedModelId {
  return (APPROVED_MODELS as readonly string[]).includes(value);
}
```

Adding xAI / OpenAI later is a one-line addition per model — the Gateway handles provider routing for all of them.

**`src/lib/models/registry.ts`**

```ts
import { gateway } from '@ai-sdk/gateway';
import type { ApprovedModelId } from './approved-models';

/**
 * All model calls route through the Vercel AI Gateway using BYOK:
 * our Anthropic + Google keys are stored in Vercel's Gateway BYOK
 * configuration (managed via the Vercel dashboard / CLI), NOT in
 * application env or code. Zero Gateway markup on tokens — we keep
 * our existing provider billing relationships. The Gateway layers
 * unified auth, cost tracking, failover, and provider routing on top.
 */
export function getModel(id: ApprovedModelId) {
  return gateway(id);
}
```

No per-provider SDKs imported, no direct provider secrets in env. Every model call is observable in the Gateway dashboard and subject to its rate/cost controls.

**Migration note:** The existing Platform Agent in `src/lib/agent/` calls the Anthropic provider SDK directly today. Migrating the existing harness to the Gateway is a separate follow-up (not blocking this pilot) — this spec introduces the Gateway path for the new subagent layer only. Both paths can coexist during the migration window.

**`src/lib/models/resolve.ts`**

```ts
export function resolveModel(agentSlug: string, defaultModel: ApprovedModelId) {
  const envKey = `TATARA_MODEL_OVERRIDE_${slugToEnv(agentSlug)}`;
  const override = process.env[envKey];
  const modelId =
    override && isApprovedModelId(override) ? override : defaultModel;
  if (override && !isApprovedModelId(override)) {
    console.warn(`[models] Invalid override for ${agentSlug}: ${override}; using default ${defaultModel}`);
  }
  return getModel(modelId);
}

// slugToEnv: camelCase/PascalCase agent slug → SCREAMING_SNAKE_CASE.
// Examples:
//   'BrainExplore'     → 'BRAIN_EXPLORE'
//   'DCPVerifier'      → 'DCP_VERIFIER'
//   'WebResearch'      → 'WEB_RESEARCH'
//   'ChangeClassifier' → 'CHANGE_CLASSIFIER'
function slugToEnv(slug: string): string {
  return slug.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}
```

**Env value format is the `ApprovedModelId` string verbatim** — the resolver does no translation. Example: `TATARA_MODEL_OVERRIDE_BRAIN_EXPLORE=google/gemini-2.5-flash-lite` swaps BrainExplore to Flash-Lite at runtime with no code change. Any value not in `APPROVED_MODELS` triggers a console warning and falls through to the default.

### 5.2 Subagent types

**`src/lib/subagent/types.ts`**

```ts
export interface BuiltInAgentDefinition {
  agentType: string;                       // unique slug, e.g. 'BrainExplore'
  whenToUse: string;                       // parent-facing description
  model: ApprovedModelId | 'inherit';      // 'inherit' = use parent's model
  tools?: string[];                        // allowlist
  disallowedTools?: string[];              // denylist (typical for read-only)
  getSystemPrompt: () => string;
  omitBrainContext?: boolean;              // skip manifest injection (fast agents)
  background?: boolean;                    // reserved — not wired in pilot
  maxTurns?: number;                       // default 15 if unset
  outputContract?: OutputContract;
}

export interface OutputContract {
  type: 'freeform' | 'verdict' | 'json';
  validator?: (text: string) => { ok: true } | { ok: false; reason: string };
}

export type SubagentResult =
  | { ok: true; text: string; usage: TokenUsage; subagentType: string }
  | { ok: false; error: string; partialText?: string };
```

### 5.3 Dispatch tool (`AgentTool`)

**`src/lib/subagent/AgentTool.ts`**

Tool schema the Platform Agent sees:

```ts
{
  name: 'Agent',
  description: buildAgentToolDescription(getBuiltInAgents()),  // dynamic
  parameters: z.object({
    description: z.string().min(3).max(60),
    subagent_type: z.string(),
    prompt: z.string().min(1),
  }),
}
```

Per-turn caps enforced at execution time (not schema time, so the LLM gets useful error results):

- Max subagent invocations per parent turn: **10** (env: `TATARA_MAX_SUBAGENTS_PER_TURN`)
- Unknown `subagent_type`: return structured error listing available types

### 5.4 Dynamic prompt builder

**`src/lib/subagent/prompt.ts`**

Builds the Agent tool description at boot and after any registry change. Output shape mirrors claude-code's `getPrompt()`:

```
Launch a new agent to handle complex, multi-step tasks autonomously.

Available agent types and the tools they have access to:
- BrainExplore: Fast agent for navigating the brain — manifest, documents, frontmatter. ... (Tools: All tools except write_document, update_frontmatter, delete_document, create_document, Agent)

When using the Agent tool, specify a subagent_type parameter to select which agent type to use.

Usage notes:
- Include a short description (3-5 words) summarizing what the subagent will do
- The subagent starts fresh — brief it like a colleague who hasn't seen this conversation
- Subagent output is not visible to the user; summarize its findings in your own reply
- Launch multiple agents in parallel when tasks are independent — single message, multiple tool calls

Writing the prompt:
- Explain what you're trying to accomplish and why
- Describe what you've already ruled out
- If you need a short response, say so ("report in under 200 words")
- Never delegate understanding — include file/document specifics rather than pushing synthesis onto the subagent
```

### 5.5 `runSubagent`

**`src/lib/subagent/runSubagent.ts`**

Flow:

1. Look up the `BuiltInAgentDefinition` by `subagent_type`. Unknown → `{ ok: false, error }`.
2. Build fresh `AgentContext`: inherit `companyId` / `userId` / `brainId`; `sessionId: null`; `agentDefinitionId: 'builtin:<slug>'`; `abortSignal` inherited from parent.
3. Filter scopes/capabilities against the agent's allow/deny lists.
4. Build the subagent tool set:
   - Call the existing `buildToolSet(ctx, externalTools, externalToolMeta)` from `src/lib/agent/tool-bridge.ts` to produce the full toolset the parent would see in the same context. `buildToolSet` already applies its own context-based filtering (`toolAllowed(t, ctx)`); we do not modify that function.
   - Apply a **new `filterSubagentTools(fullToolset, def)` helper in `src/lib/subagent/`** that takes `buildToolSet`'s output and strips keys according to `def.tools` (allowlist) or `def.disallowedTools` (denylist). This wrapper lives in `subagent/` — the harness is untouched, preserving the §4 "zero harness change" guarantee.
   - The `Agent` tool itself is always removed from the subagent's toolset (hardcoded denylist addition) to prevent nested spawning regardless of the agent definition's config.
5. Fire the `SubagentStart` hook (already declared in `src/lib/agent/types.ts`).
6. Call `runAgentTurn` with:
   - `systemPrompt` from `def.getSystemPrompt()`
   - `model` from `resolveModel(def.agentType, def.model)` (or parent's model if `'inherit'`)
   - `tools` from step 4
   - `messages: [{ role: 'user', content: invocation.prompt }]`
   - `maxTurns` from `def.maxTurns ?? 15`
   - `omitBrainContext` from `def.omitBrainContext ?? false`
7. Collect the final text + usage.
8. If `def.outputContract?.validator` is set, run it. Failure → `{ ok: false, error, partialText }`.
9. Emit `subagent.invoked` audit event (see **audit + usage ordering** rule below).
10. Return `{ ok: true, text, usage, subagentType }`.

Abort propagation is automatic — the subagent's `streamText` call shares the parent's `AbortSignal`.

**Audit event + `usage_records` ordering under failure (required rule).** Three invariants must hold regardless of how a subagent call fails:

1. **`usage_records` is always written if the provider returned any tokens** — including on mid-stream abort, validator failure, maxTurns exhaustion, or provider 500 after partial output. The row captures whatever input/output token counts the provider reported. This prevents unbilled-token drift and keeps cost dashboards honest even on failure paths.
2. **The `subagent.invoked` audit event always fires**, with a required `status` field: `ok` (validator passed, final text returned) | `validator_failed` | `max_turns` | `aborted` | `provider_error` | `cap_exceeded` | `unknown_type`. Status `unknown_type` and `cap_exceeded` fire pre-dispatch and have zero token usage; the audit event is still required for observability.
3. **Ordering**: `usage_records` write → audit event fire → return to caller. Both database writes go through the existing audit helper's retry path; a failure to write either is logged but does not itself throw — the subagent's result is already determined.

**`omitBrainContext` default behavior.** When `false` (default), the subagent receives the same manifest block the parent Platform Agent would get for the same brain, assembled by the existing `system-prompt.ts` helper. When `true` (BrainExplore pilot), the manifest is omitted entirely — the subagent's first tool call is expected to be `manifest_read` if it needs the index. There is no "trimmed" middle option in the pilot; it is all-or-nothing.

### 5.6 BrainExplore pilot

**`src/lib/subagent/built-in/brainExploreAgent.ts`**

Full system prompt baked inline in the agent file; output-format block reproduced in §5.6a below. Key config:

- `model: 'anthropic/claude-haiku-4.5'`
- `disallowedTools: ['write_document', 'update_frontmatter', 'delete_document', 'create_document', 'Agent']`
- `omitBrainContext: true` (BrainExplore's first tool call is typically `manifest_read`; pre-injection would duplicate)
- `maxTurns: 30` (supports 200+ doc brains with search refinement + multiple doc reads)
- `outputContract.validator`: parses the Sources section and matches each bullet against a line-anchored regex: ``/^- .+ — slug: `[^`]+` — id: `[^`]+`$/m``. The exact template shape is required; free prose mentioning the words "slug" and "id" in other sections will not false-positive.

#### 5.6a Output format enforcement (required)

The BrainExplore system prompt requires this structure for every reply:

```
1. Answer — 1-3 sentences.
2. Sources — bulleted list. EVERY line MUST include both slug and id:
   - <title> — slug: `<slug>` — id: `<document-id>`
   Source lines missing either field are rejected.
3. Gaps (optional) — brain-coverage observations.
```

The validator parses the Sources section and fails the invocation if any bullet omits `slug:` or `id:`. The parent agent sees the failure as a normal tool result and can either re-dispatch with a stronger brief or fall back to running searches itself.

## 6. Data flow

```
User ──▶ Platform Agent turn (runAgentTurn)
              │
              │ calls Agent tool
              ▼
        AgentTool.execute
              │
              │ runSubagent(parentCtx, invocation)
              ▼
        BrainExplore turn (runAgentTurn, fresh ctx)
              │
              ├─ manifest_read
              ├─ search_documents (parallel queries)
              ├─ get_document × N (parallel)
              ▼
        Final text with Sources block
              │
              │ outputContract.validator
              ▼
        { ok: true, text } ──▶ Platform Agent sees as tool result
              │
              ▼
        Platform Agent synthesizes reply to user
```

**Parallel spawn example:**

Platform Agent fires three `Agent` tool calls in one message (independent research questions). `runSubagent` runs three times concurrently. Usage records are all written with the same `parent_usage_record_id`. The dashboard can show the turn cost including all three subagents.

## 7. Schema changes

One migration on `usage_records`. The column is named `parent_usage_record_id` (not `parent_turn_id`) because `usage_records` is **one row per LLM call**, not one row per conversational turn. A Platform Agent turn that calls three subagents produces 1 + 3 rows; all three subagent rows reference the Platform Agent row.

```sql
ALTER TABLE usage_records
  ADD COLUMN parent_usage_record_id UUID NULL
  REFERENCES usage_records(id) ON DELETE SET NULL;

CREATE INDEX idx_usage_records_parent_usage_record_id
  ON usage_records(parent_usage_record_id);
```

Nullable: Platform Agent calls have no parent. Subagent calls populate the FK with the parent call's `usage_records.id`. Enables attribution queries (`sum of provider_cost_usd where parent_usage_record_id = <parent id>`) and budget-cap accounting across parent + subagents.

An audit event type `subagent.invoked` is added to the audit enum (existing migration pattern in `db/schema/enums.ts`).

## 8. Error handling

| Failure | Behavior |
|---|---|
| Unknown `subagent_type` | `AgentTool` returns `{ ok: false, error: 'Unknown type; available: [...]' }`. Parent sees as tool result, can retry with correct type. |
| `maxTurns` exhausted | Subagent returns partial text with `[stopped at maxTurns cap — partial findings]` suffix. `{ ok: true }` — caller decides how to handle. |
| `outputContract.validator` fails | `{ ok: false, error, partialText }`. Parent can re-dispatch with tighter brief. |
| Subagent model errors (rate limit, 500) | Surface as `{ ok: false, error: '<provider error>' }`. No automatic retry — parent decides. |
| Abort signal fires | Subagent cancels; `{ ok: false, error: 'aborted' }`. |
| Invalid env model override | Logged warning at resolve time; falls back to agent's default model. Never throws. |
| Per-turn cap (10) exceeded | `AgentTool` returns `{ ok: false, error: 'subagent cap of 10/turn reached' }` without dispatching. |
| Nested spawn attempt (subagent calling `Agent`) | Denylisted at toolset construction — the `Agent` tool is never passed to subagents, so the LLM cannot call it. |

All errors are observable via the `subagent.invoked` audit event (status field) and `usage_records` (turn may have zero tokens if failure was pre-dispatch).

## 9. Testing

### 9.1 Unit tests (CI-gated, mock LLM)

- `models/registry.test.ts` — registry boot, invalid provider ID handling.
- `models/resolve.test.ts` — env override parsing, invalid-override warning, default fallback.
- `subagent/registry.test.ts` — `getBuiltInAgent()` returns/doesn't-return correctly.
- `subagent/AgentTool.test.ts` — Zod schema accepts valid calls, rejects invalid; unknown type returns structured error; cap enforcement.
- `subagent/runSubagent.test.ts` — (with `runAgentTurn` mocked) fresh session, scope filtering, tool filtering, hook fires, `maxTurns` threaded, abort propagates, validator runs.
- `subagent/prompt.test.ts` — dynamic description renders correctly for 0, 1, and N agents; tool listing accurate.

### 9.2 Integration tests (CI-gated, LLM mocked via AI SDK test helpers)

- `brain-explore.integration.test.ts` — seeded brain (5-10 docs), recorded Haiku response. Asserts: output format matches, validator passes, `usage_records` row with `parent_usage_record_id` written, `subagent.invoked` audit event written.
- `parent-spawn-parallel.test.ts` — three BrainExplore calls in one parent turn, all succeed, eleventh returns cap error.
- `output-contract-failure.test.ts` — malformed Sources block triggers validator failure; parent sees `{ ok: false, partialText }`.

### 9.3 Eval suite (scheduled, real models)

Location: `src/lib/subagent/evals/brain-explore/`

- 15-20 golden queries against a fixture brain with known expected slugs.
- Metrics: answer accuracy, source-slug completeness, format-validator pass rate, avg tool calls, avg latency, tokens in/out.
- Matrix runs: Haiku 4.5 vs Flash-Lite. The eval runner accepts a `--model=<ApprovedModelId>` CLI flag that constructs the model directly via `getModel(id)`, bypassing the env-override indirection. This makes a single eval process iterate both models without subprocess isolation. Results captured in `evals/results/<date>/`.
- Runs on schedule, not on every commit. A CI job fails only if the latest recorded run is more than N days old — prevents silent drift.

### 9.4 Manual smoke (pre-prod-rollout)

- One BrainExplore invocation from a real Platform Agent conversation in staging.
- Check: output format correct, slugs/ids real, Platform Agent cites them in the user-visible reply, `usage_records` and audit event both written.

## 10. Rollout

Behind a feature flag `TATARA_SUBAGENTS_ENABLED` (env). Off in prod on merge.

1. Merge `src/lib/models/` (no consumers yet).
2. Merge `src/lib/subagent/` with empty registry.
3. Merge `brainExploreAgent.ts`; registry returns one agent.
4. Wire `Agent` tool into `tool-bridge.ts` behind the feature flag. Platform Agent in prod still blind to it.
5. Run migration on `usage_records` in staging, run eval + smoke, flip flag in staging.
6. Run migration in prod, flip flag in prod.

Each step is independently revertable. The `usage_records` migration is additive (nullable column + index) so it doesn't require data backfill.

**Kill-switch posture.** Flipping `TATARA_SUBAGENTS_ENABLED` off removes the `Agent` tool from the parent's toolset immediately; no new subagent dispatches happen. The schema migration stays in place — `parent_usage_record_id` being NULL for all rows is the safe rolled-back state. No destructive rollback is required for any step of the rollout.

## 11. Open questions (for reviewer)

1. **Model-override format.** Env-var-per-agent (`TATARA_MODEL_OVERRIDE_BRAIN_EXPLORE=...`) works for eval but won't scale to per-company A/B when multi-tenant routing matters. Leaving it as-is for the pilot; revisit when second agent ships.
2. **Parent-turn subagent cap of 10.** Chosen to accommodate ~3-4 parallel fan-outs per turn with headroom. No data yet on real-world usage. Worth measuring in the first month after rollout.
3. **Subagent actor type.** Pilot uses `platform_agent` even for subagent turns. A distinct `subagent` actor type would sharpen audit queries but adds complexity to permission evaluator. Deferred until we have two subagents running in prod.
4. **Streaming subagent output to parent.** Not in pilot — the parent waits for the subagent's final message. If BrainExplore latency becomes a UX problem, streaming partial synthesis is possible but non-trivial.
5. **BYOK pricing + gateway semantics verification.** The spec assumes Vercel AI Gateway BYOK has zero token markup, preserves existing provider billing relationships, and applies no independent rate limits beyond the underlying provider's. This is load-bearing for the subagent strategy's economics. The implementer MUST confirm current Gateway BYOK terms against [vercel.com/docs/ai-gateway/pricing](https://vercel.com/docs/ai-gateway/pricing) before the production rollout step (§10 step 6) and flag any deltas.
6. **`runAgentTurn` hand-rolled harness vs AI SDK `ToolLoopAgent`.** The spec reuses the existing hand-rolled harness rather than adopting the AI SDK's `ToolLoopAgent` primitive for subagents. This is a deliberate continuation of the project's "Vercel AI SDK + hand-roll" stack choice — the harness provides hook-bus integration and permission-evaluator hooks that `ToolLoopAgent` does not. Revisit if the harness grows substantially in complexity beyond Phase 2.

## 12. Success criteria

Pilot is successful when:

- A live Platform Agent call can dispatch BrainExplore and cite its source slugs in a user-visible reply.
- Eval harness produces a published Haiku-vs-Flash-Lite comparison with clear winner (or clear no-difference).
- `usage_records` queries can correctly sum parent + all child subagents for any given turn via `parent_usage_record_id`.
- Adding the second built-in agent (whichever ships next) requires no changes to `src/lib/models/` or `src/lib/subagent/` core — only a new file under `built-in/` and registry entry.

---

## Revision log

- 2026-04-19 — initial design; BrainExplore pilot scope only.

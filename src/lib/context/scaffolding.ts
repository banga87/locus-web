// SessionStart payload builder — pure, no DB imports.
//
// `buildScaffoldingPayload` assembles the InjectedContext the chat
// route's SessionStart hook hands back as a `{ decision: 'inject',
// payload }` response. The handler itself lives in `./register.ts`;
// this module stays pure so the logic is trivially unit-testable
// (the `scaffolding.test.ts` suite mocks the repo).
//
// Order of blocks — stable and significant because the system prompt
// builder concatenates them in the order they land here:
//   1. `scaffolding` — the company's agent-scaffolding doc (partial-
//      unique per company, enforced by `documents_company_scaffolding
//      _unique` in migration 0008). Always present when wired.
//   2. `agent-prompt-snippet` — free-form persona text from the
//      active `agent-definition` doc's `system_prompt_snippet`
//      frontmatter. Only emitted if the snippet is non-empty.
//   3. `baseline` — one block per doc id in the agent-definition's
//      `baseline_docs` frontmatter array, in array order. An
//      `archived`-status baseline gets an appended note so the agent
//      knows the content may be stale (doc owners sometimes archive
//      baselines without refreshing the agent wiring).
//
// Degradation rules:
//   - Missing scaffolding doc  → return `{ blocks: [] }` + warn. The
//     chat route's SessionStart handler still injects this empty
//     payload; `runAgentTurn` refuses `inject` in Phase 1 (it throws
//     on the first inject decision), but the `register.ts` wrapper
//     catches any throw and downgrades to `{ decision: 'allow' }` so
//     the turn survives. (Phase 2 adds splice semantics.)
//   - Missing `agent-definition` doc → scaffolding block still lands.
//     Sessions with a stale `agentDefinitionId` (e.g. the doc got
//     soft-deleted) degrade to the default Platform Agent experience
//     rather than failing the turn.

import type { ContextBlock, InjectedContext } from './types';

/** Shape the scaffolding builder needs from the brain. Injected —
 *  Drizzle queries live in `./repos.ts` so this module stays pure
 *  and platform-agnostic. */
export interface ScaffoldingRepo {
  /**
   * Load the company's single `agent-scaffolding` document. Returns
   * `null` when no row exists — callers (only `buildScaffoldingPayload`
   * today) must treat this as "no scaffolding injected" rather than an
   * error.
   */
  getAgentScaffolding(companyId: string): Promise<{
    id: string;
    title: string;
    body: string;
    /**
     * Monotonic version — the frontmatter `version:` field. The in-
     * process cache in `./repos.ts` keys by this so a version bump
     * automatically invalidates the cached body.
     */
    version: number;
  } | null>;

  /**
   * Load an `agent-definition` document by id. Returns `null` when the
   * doc is missing, soft-deleted, or not of type `agent-definition` —
   * all three cases degrade to "default Platform Agent" semantics.
   */
  getAgentDefinition(id: string): Promise<{
    id: string;
    title: string;
    systemPromptSnippet: string;
    baselineDocIds: string[];
  } | null>;

  /**
   * Batch-fetch baseline docs. Callers pass the `baselineDocIds` array
   * straight through; the repo short-circuits an empty input to `[]`
   * so the caller never has to handle a Drizzle `IN ()` edge case.
   */
  getDocsByIds(ids: string[]): Promise<
    Array<{
      id: string;
      title: string;
      body: string;
      status: 'draft' | 'active' | 'archived';
    }>
  >;
}

export interface ScaffoldingInput {
  companyId: string;
  /**
   * `null` signals the default Platform Agent (no user-built agent is
   * bound to this session). Task 2 stores this on `sessions.agent_
   * definition_id`; the SessionStart handler pipes it through via
   * `event.ctx.agentDefinitionId ?? null`.
   */
  agentDefinitionId: string | null;
}

/**
 * Build the SessionStart `InjectedContext` payload. Pure — the
 * `ScaffoldingRepo` argument is the only side-effectful dependency and
 * is injected at the call site. Never throws: all error paths degrade
 * gracefully (empty blocks for missing scaffolding, scaffolding-only
 * for missing agent-def). A throw here would cascade up to the hook
 * bus, which treats handler throws as hard turn failures — the wrapper
 * in `./register.ts` still catches, but this function targets the
 * "happy paths never throw" side of the contract.
 */
export async function buildScaffoldingPayload(
  input: ScaffoldingInput,
  repo: ScaffoldingRepo,
): Promise<InjectedContext> {
  const blocks: ContextBlock[] = [];

  // 1. Scaffolding doc. Anchors the payload; without it we emit an
  //    empty InjectedContext + a warning. Operators should spot the
  //    warning in logs for any company that hasn't run setup.
  const scaffolding = await repo.getAgentScaffolding(input.companyId);
  if (!scaffolding) {
    // TODO: wire to the observability skill's structured logger once
    // Task 9's instrumentation lands. console.warn is fine for MVP —
    // the message includes the companyId so support can grep for it.
    console.warn(
      `[context/scaffolding] no agent-scaffolding doc found for company ${input.companyId}; returning empty payload`,
    );
    return { blocks: [] };
  }
  blocks.push({
    kind: 'scaffolding',
    title: scaffolding.title,
    body: scaffolding.body,
    sourceDocId: scaffolding.id,
  });

  // 2. No agent bound → scaffolding-only payload. The default Platform
  //    Agent uses the base system prompt + scaffolding; it has no
  //    agent-specific snippet or baselines.
  if (!input.agentDefinitionId) return { blocks };

  // 3. Agent-definition lookup. A missing row (soft-deleted, renamed
  //    away from `agent-definition`, or never existed) degrades to the
  //    default-agent shape — scaffolding stays, nothing else is
  //    appended. This is the documented behaviour when a session's
  //    `agent_definition_id` FK has been `SET NULL`'d mid-flight.
  const agent = await repo.getAgentDefinition(input.agentDefinitionId);
  if (!agent) return { blocks };

  // 4. Agent persona snippet. Only injected if the wizard actually
  //    filled it in — an empty snippet would just waste tokens.
  if (agent.systemPromptSnippet) {
    blocks.push({
      kind: 'agent-prompt-snippet',
      title: `Agent: ${agent.title}`,
      body: agent.systemPromptSnippet,
      sourceDocId: agent.id,
    });
  }

  // 5. Baseline docs. Batch-fetched so the SessionStart critical path
  //    makes one round-trip instead of N. The repo handles the empty-
  //    array short-circuit (see `./repos.ts`).
  if (agent.baselineDocIds.length > 0) {
    const docs = await repo.getDocsByIds(agent.baselineDocIds);
    for (const doc of docs) {
      // Case-insensitive "archived" mention lets the agent flag stale
      // context to the user when the baseline is no longer active.
      const archivedNote =
        doc.status === 'archived'
          ? '\n\n_note: this baseline doc is archived; content may be stale._'
          : '';
      blocks.push({
        kind: 'baseline',
        title: doc.title,
        body: doc.body + archivedNote,
        sourceDocId: doc.id,
      });
    }
  }

  return { blocks };
}

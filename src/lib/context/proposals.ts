// PostToolUse handler for propose_document_* tools.
//
// This handler is deliberately a documented NO-OP today. It exists as
// a hook-bus touchpoint so that future audit enrichment + telemetry
// work (Phase 2 PR streams, "who approved what" audit chains) has a
// dedicated landing zone — instead of retrofitting into
// `tool-bridge.ts` or the chat route.
//
// Why it doesn't inject anything:
//   - The propose tools' `execute` already returns `{ proposal,
//     isProposal: true }`. That payload travels through the AI SDK's
//     normal tool-result channel: the UI part renderer
//     (`message-bubble.tsx` → `tool-call-indicator.tsx`) sees it on
//     the client with zero extra plumbing.
//   - There's nothing to splice into the next model prompt — the
//     LLM has already observed the tool result and will continue
//     reasoning with it in context.
//   - Returning `allow` keeps the hook bus's short-circuit contract
//     intact: any later PostToolUse handlers (Phase 2 audit) still
//     get dispatched.
//
// Why bother registering it at all:
//   - Locks in the "never denies, never mutates, never injects"
//     invariant as a tested contract. A future PR that "accidentally"
//     writes to the DB from PostToolUse gets caught by the paired
//     unit test.
//   - Centralises the propose-tool recognition rule (the
//     `propose_document_` prefix) so future tools in this family
//     don't need to teach multiple handlers about the discriminator.

import type { HookDecision, HookEvent } from '@/lib/agent/types';

/**
 * Prefix every propose-tool shares. Kept exported so the register /
 * test modules can reference the same constant and stay in sync with
 * the tool names registered in `src/lib/agent/tool-bridge.ts`.
 */
export const PROPOSE_TOOL_PREFIX = 'propose_document_';

/**
 * PostToolUse handler. Recognises `propose_document_*` tool results
 * and returns `{ decision: 'allow' }` — the proposal payload is
 * already visible to the UI via the tool-result stream; this handler
 * is purely a marker for future audit/telemetry expansion.
 *
 * Contract:
 *   - Never throws. Any future expansion must preserve this: the
 *     register.ts wrapper catches defensively, but a hook that
 *     throws would fail the turn outright.
 *   - Never denies. Proposals are already user-gated at approval;
 *     denying them in-hook would be surprising + would need a new
 *     client-side code path for "agent tried to propose but the
 *     platform refused" — not a Phase 1.5 concern.
 *   - Never injects. There is no additional context to feed back
 *     into the prompt — the tool-result chunk carries the payload.
 */
export async function proposalPostToolUseHandler(
  event: HookEvent,
): Promise<HookDecision> {
  // Defence-in-depth narrow. The bus already routes by event name,
  // so a non-PostToolUse event reaching this handler would indicate
  // a future bus refactor (e.g. broadcast mode). Returning `allow`
  // is the safe default.
  if (event.name !== 'PostToolUse') return { decision: 'allow' };

  // Only fire on propose-tool results. Non-propose tools (search,
  // get, diff, MCP OUT) flow through unchanged — this handler is
  // silent for them.
  if (!event.toolName.startsWith(PROPOSE_TOOL_PREFIX)) {
    return { decision: 'allow' };
  }

  // The proposal is already in `event.result` via the tool-result
  // stream. The renderer picks it up from the `isProposal` flag on
  // the result object (see `tool-call-indicator.tsx`). Nothing to
  // inject; nothing to persist here (audit + analytics land in
  // Phase 2).
  return { decision: 'allow' };
}

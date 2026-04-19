// Registers context-injection handlers on the Phase 1 hook bus.
//
// Called from the chat route (and any future surface that runs
// `runAgentTurn`) to wire `SessionStart` → InjectedContext payload.
// The call is idempotent — a module-level flag prevents double-
// registration when Next.js hot-reloads the route in dev or when
// multiple route handlers import this module from the same process.
//
// Critical contract with the hook bus (see
// `src/lib/agent/hooks.ts` + the module header for the proof):
//   1. `registerHook(name, handler)` allows MULTIPLE handlers per
//      event; registration order is execution order.
//   2. The bus runs handlers serially and **short-circuits on the
//      first non-allow decision**. That means exactly one injector
//      per `SessionStart` — a second handler registered on the same
//      event would never run because this one returns `inject`.
//   3. A handler that throws propagates the error as a **hard turn
//      failure**. Spec requires context handlers to "log and continue,
//      never throw" — enforced below by wrapping the entire handler
//      body in a try/catch that returns `{ decision: 'allow' }` on
//      any error. Bugs in the scaffolding loader, malformed brain
//      docs, transient DB outages — all downgrade to a scaffolding-
//      less turn rather than a 500.
//
// What this module deliberately does NOT import:
//   - `next/*` / `@vercel/functions` / request objects: we stay
//     platform-agnostic so the same handler set can run from the
//     autonomous-loop or maintenance-agent surfaces once they wire in
//     (see the harness-boundary note in `AGENTS.md`).

import { registerHook } from '@/lib/agent/hooks';
import type { HookDecision, HookEvent } from '@/lib/agent/types';

import { proposalPostToolUseHandler } from './proposals';
import {
  createDbScaffoldingRepo,
  createDbUserPromptRepo,
} from './repos';
import { buildScaffoldingPayload } from './scaffolding';
import { buildUserPromptPayload } from './user-prompt';

let registered = false;

/**
 * Wire Locus's context-injection handlers onto the hook bus. Safe to
 * call on every chat request — a module-level flag makes subsequent
 * invocations no-op. Phase 1.5 only registers `SessionStart`; the
 * user-prompt + proposals handlers ship in Tasks 6 + 7.
 */
export function registerContextHandlers(): void {
  if (registered) return;
  registered = true;

  // Factories are instantiated per call: they're thin closures over the
  // module-level db client, so allocation cost is negligible. Do NOT
  // memoise them module-level — that breaks the test-only cache-reset
  // helpers by creating lifetime coupling between hot-reloads and repo
  // state.
  registerHook(
    'SessionStart',
    async (event: HookEvent): Promise<HookDecision> => {
      // Discriminated-union narrow. `registerHook` types the handler
      // against the whole HookEvent union — this guard lets us read
      // `event.ctx` with full type safety and also acts as defence
      // in depth if anyone ever changes the bus to broadcast across
      // events.
      if (event.name !== 'SessionStart') {
        return { decision: 'allow' };
      }
      try {
        const repo = createDbScaffoldingRepo();
        const payload = await buildScaffoldingPayload(
          {
            companyId: event.ctx.companyId,
            // `agentDefinitionId` is optional on AgentContext (may be
            // `undefined` when the caller didn't set it); coerce both
            // `undefined` and `null` to a single `null` sentinel so the
            // builder's input contract stays tight.
            agentDefinitionId: event.ctx.agentDefinitionId ?? null,
          },
          repo,
        );
        return { decision: 'inject', payload };
      } catch (err) {
        // Context injection is best-effort. The hook bus would turn a
        // throw into a hard turn failure — log instead and return
        // `allow` so the user still gets an answer, just without the
        // scaffolding/baseline context. The chat turn proceeds with
        // only the base system prompt.
        console.warn(
          '[context/register] SessionStart handler failed; continuing without injected context',
          err,
        );
        return { decision: 'allow' };
      }
    },
  );

  registerHook(
    'UserPromptSubmit',
    async (event: HookEvent): Promise<HookDecision> => {
      // Discriminated-union narrow — same defence-in-depth pattern as
      // the SessionStart handler above. The bus routes per-event, so
      // this mismatch is not possible in practice, but a future bus
      // refactor (e.g. a broadcast mode) would silently call us with
      // the wrong shape without this guard.
      if (event.name !== 'UserPromptSubmit') {
        return { decision: 'allow' };
      }
      try {
        // Extract the user's text for parity with the builder input
        // contract (the field is retained for future per-turn
        // injections, even though the attachments-only builder does
        // not currently consume it). No message → nothing to inject.
        const userMessage = extractUserMessageText(event.message);
        if (!userMessage) return { decision: 'allow' };

        const repo = createDbUserPromptRepo();
        const payload = await buildUserPromptPayload(
          {
            companyId: event.ctx.companyId,
            // A null `sessionId` is possible for one-off invocations
            // (see `AgentContext.sessionId` — "rare"). The attachments
            // lookup has nothing to correlate on, so coerce to an
            // empty string and let the query return `[]`.
            sessionId: event.ctx.sessionId ?? '',
            userMessage,
          },
          repo,
        );

        // Empty payload — short-circuit as `allow` so the harness
        // doesn't splice a no-op system-role message into the turn.
        if (payload.blocks.length === 0) return { decision: 'allow' };

        return { decision: 'inject', payload };
      } catch (err) {
        // Context injection is best-effort. Any throw — transient DB
        // blip, buggy repo method — degrades to an attachment-less
        // turn rather than a hard failure. The SessionStart
        // scaffolding block and base system prompt still reach the
        // LLM.
        console.warn(
          '[context/register] UserPromptSubmit handler failed; continuing without injected context',
          err,
        );
        return { decision: 'allow' };
      }
    },
  );

  // Phase 1.5 Task 7: PostToolUse handler for user-gated write
  // proposals. The handler itself is a documented no-op today (the
  // propose-tool result already surfaces to the UI via the tool-
  // result stream) — but registering it now gives Phase 2 audit /
  // telemetry a clean extension point. The try/catch mirror matches
  // the SessionStart + UserPromptSubmit handlers above: best-effort,
  // a throw here must never fail the turn.
  registerHook(
    'PostToolUse',
    async (event: HookEvent): Promise<HookDecision> => {
      try {
        return await proposalPostToolUseHandler(event);
      } catch (err) {
        console.warn(
          '[context/register] PostToolUse proposals handler failed; allowing turn to continue',
          err,
        );
        return { decision: 'allow' };
      }
    },
  );
}

/**
 * Extract user-visible text from the harness's `ModelMessage`-shaped
 * `message` payload. `UserModelMessage.content` is `string | Array<
 * TextPart | ImagePart | FilePart>` in AI SDK v6 — we concatenate
 * every text part (ignoring images / files, which the skill matcher
 * has no use for) and trim the result.
 *
 * Returns `null` when:
 *   - the input is `undefined` / `null`
 *   - the shape isn't recognisable (defence-in-depth against future
 *     ModelMessage variants; the harness's `message` is typed
 *     `unknown` on the hook payload so this runs at runtime)
 *   - every text part is empty after concatenation
 *
 * Local to this module — the skill-matching half is a pure function in
 * `./user-prompt.ts` and has its own tests; this shim is only the glue
 * between the hook bus's `unknown`-typed payload and the builder's
 * `userMessage: string` input.
 */
function extractUserMessageText(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const content = (raw as { content?: unknown }).content;
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        parts.push((part as { text: string }).text);
      }
    }
    const joined = parts.join('\n').trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
}

/**
 * Reset the module-level registration flag. Test-only — production
 * code has no reason to re-register on the same process.
 */
export function __resetContextHandlersForTests(): void {
  registered = false;
}

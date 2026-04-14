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

import { createDbScaffoldingRepo } from './repos';
import { buildScaffoldingPayload } from './scaffolding';

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

  // Phase 1.5 Task 6 adds: registerHook('UserPromptSubmit', ...)
  // Phase 1.5 Task 7 adds: registerHook('PreToolUse', ...) for the
  //   brain-write proposals flow (reads / writes go to different
  //   toolsets in the MCP registry so this is still one injector
  //   per event).
}

/**
 * Reset the module-level registration flag. Test-only — production
 * code has no reason to re-register on the same process.
 */
export function __resetContextHandlersForTests(): void {
  registered = false;
}

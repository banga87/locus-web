// Typed hook event bus. Modelled on claude-code's `runHook` semantics:
// handlers run **serially in registration order**; the **first** non-allow
// decision short-circuits the chain and is returned. Phase 1 ships with
// zero registered handlers — every `runHook` call returns
// `{ decision: 'allow' }`. The bus exists today so Phase 2 (Permission
// Evaluator, audit enrichment, autonomous safety gates) can plug in
// without touching the harness or the chat route.
//
// Module-local registry. Tests must call `clearHooks()` between cases —
// Vitest gives each test file a fresh module instance, but cases inside
// the same file share state.

import type { HookDecision, HookEvent, HookHandler } from './types';

const handlers: Partial<Record<HookEvent['name'], HookHandler[]>> = {};

/**
 * Register a handler for `name`. Multiple handlers per event are allowed;
 * registration order is execution order. The bus does NOT deduplicate —
 * registering the same function twice runs it twice.
 */
export function registerHook(
  name: HookEvent['name'],
  handler: HookHandler,
): void {
  (handlers[name] ??= []).push(handler);
}

/**
 * Drop every registered handler. Test-only by convention; production code
 * has no reason to call this.
 */
export function clearHooks(): void {
  for (const key of Object.keys(handlers) as HookEvent['name'][]) {
    handlers[key] = [];
  }
}

/**
 * Dispatch `event` to its registered handlers serially. Returns the first
 * non-allow decision, or `{ decision: 'allow' }` if every handler allowed
 * (or no handlers are registered).
 *
 * A throwing handler propagates — the harness treats that as a hard
 * failure of the turn. (Choice: surfacing handler bugs loudly beats
 * silently allowing under invalid hook state.)
 */
export async function runHook(event: HookEvent): Promise<HookDecision> {
  const list = handlers[event.name] ?? [];
  for (const h of list) {
    const decision = await h(event);
    if (decision.decision !== 'allow') return decision;
  }
  return { decision: 'allow' };
}

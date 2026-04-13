// Hook bus tests. Pure module — no DB, no external imports beyond types.
// Verifies the four guarantees Phase 2 will rely on:
//   1. Empty registry returns allow.
//   2. Handlers run serially in registration order.
//   3. First non-allow decision short-circuits.
//   4. clearHooks() resets state between tests.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearHooks, registerHook, runHook } from '../hooks';
import type { AgentContext, HookEvent } from '../types';

const TEST_CTX: AgentContext = {
  actor: {
    type: 'platform_agent',
    userId: 'u-test',
    companyId: 'c-test',
    scopes: ['read'],
  },
  brainId: 'b-test',
  companyId: 'c-test',
  sessionId: null,
  abortSignal: new AbortController().signal,
};

function sessionStartEvent(): HookEvent {
  return { name: 'SessionStart', ctx: TEST_CTX };
}

function preToolUseEvent(toolName = 'search_documents'): HookEvent {
  return { name: 'PreToolUse', ctx: TEST_CTX, toolName, args: { query: 'q' } };
}

afterEach(() => {
  clearHooks();
});

describe('agent/hooks — empty registry', () => {
  it('returns allow when no handlers are registered for an event', async () => {
    const decision = await runHook(sessionStartEvent());
    expect(decision).toEqual({ decision: 'allow' });
  });

  it('returns allow when handlers are registered for a different event only', async () => {
    registerHook('PreToolUse', () => ({ decision: 'deny', reason: 'no' }));
    const decision = await runHook(sessionStartEvent());
    expect(decision).toEqual({ decision: 'allow' });
  });
});

describe('agent/hooks — serial execution + first-non-allow-wins', () => {
  it('runs handlers in registration order and returns allow when all allow', async () => {
    const order: number[] = [];
    registerHook('SessionStart', () => {
      order.push(1);
      return { decision: 'allow' };
    });
    registerHook('SessionStart', () => {
      order.push(2);
      return { decision: 'allow' };
    });
    registerHook('SessionStart', () => {
      order.push(3);
      return { decision: 'allow' };
    });

    const decision = await runHook(sessionStartEvent());
    expect(decision).toEqual({ decision: 'allow' });
    expect(order).toEqual([1, 2, 3]);
  });

  it('short-circuits on the first deny and returns that decision', async () => {
    const h2 = vi.fn(() => ({ decision: 'allow' as const }));
    const h3 = vi.fn(() => ({ decision: 'allow' as const }));

    registerHook('PreToolUse', () => ({ decision: 'allow' }));
    registerHook('PreToolUse', () => ({
      decision: 'deny',
      reason: 'scope_violation',
    }));
    registerHook('PreToolUse', h2);
    registerHook('PreToolUse', h3);

    const decision = await runHook(preToolUseEvent());
    expect(decision).toEqual({ decision: 'deny', reason: 'scope_violation' });
    expect(h2).not.toHaveBeenCalled();
    expect(h3).not.toHaveBeenCalled();
  });

  it('short-circuits on the first inject and returns that decision (later handlers do not run)', async () => {
    const later = vi.fn(() => ({ decision: 'allow' as const }));

    registerHook('SessionStart', () => ({
      decision: 'inject',
      payload: { extra: 'context' },
    }));
    registerHook('SessionStart', later);

    const decision = await runHook(sessionStartEvent());
    expect(decision).toEqual({
      decision: 'inject',
      payload: { extra: 'context' },
    });
    expect(later).not.toHaveBeenCalled();
  });

  it('awaits async handlers and preserves serial order', async () => {
    const order: string[] = [];
    registerHook('SessionStart', async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('first');
      return { decision: 'allow' };
    });
    registerHook('SessionStart', () => {
      order.push('second');
      return { decision: 'allow' };
    });

    await runHook(sessionStartEvent());
    expect(order).toEqual(['first', 'second']);
  });
});

describe('agent/hooks — clearHooks()', () => {
  it('removes every registered handler across all event names', async () => {
    registerHook('SessionStart', () => ({ decision: 'deny', reason: 'x' }));
    registerHook('PreToolUse', () => ({ decision: 'deny', reason: 'y' }));
    registerHook('Stop', () => ({ decision: 'deny', reason: 'z' }));

    clearHooks();

    expect(await runHook(sessionStartEvent())).toEqual({ decision: 'allow' });
    expect(await runHook(preToolUseEvent())).toEqual({ decision: 'allow' });
    expect(
      await runHook({ name: 'Stop', ctx: TEST_CTX, reason: 'completed' }),
    ).toEqual({ decision: 'allow' });
  });
});

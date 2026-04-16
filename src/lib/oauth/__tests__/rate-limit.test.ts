// Tests for src/lib/oauth/rate-limit.ts — in-memory sliding-window
// rate limiter. Pure (no DB), uses fake timers to drive the window.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRateLimiter } from '../rate-limit';

describe('rate-limit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('allows up to N hits in a window', () => {
    const rl = createRateLimiter({ limit: 30, windowMs: 60_000 });
    for (let i = 0; i < 30; i++) expect(rl.check('1.2.3.4')).toBe(true);
    expect(rl.check('1.2.3.4')).toBe(false);
  });

  it('segregates by key', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
    expect(rl.check('b')).toBe(true);
  });

  it('windows slide', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 1000 });
    rl.check('a');
    rl.check('a');
    expect(rl.check('a')).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rl.check('a')).toBe(true);
  });
});

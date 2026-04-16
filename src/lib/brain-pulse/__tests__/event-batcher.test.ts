import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createEventBatcher } from '../event-batcher';

describe('createEventBatcher', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('flushes queued events in one callback after flushMs', () => {
    const flush = vi.fn();
    const b = createEventBatcher({ flush, initialIntervalMs: 100 });
    b.push('a'); b.push('b'); b.push('c');
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(99); expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('escalates to high-load interval when rate exceeds highLoadThreshold', () => {
    const flush = vi.fn();
    const b = createEventBatcher({
      flush, initialIntervalMs: 100, highLoadIntervalMs: 250, highLoadThreshold: 10,
    });
    for (let i = 0; i < 15; i++) b.push(`e${i}`);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) b.push(`f${i}`);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('clears timer on dispose', () => {
    const flush = vi.fn();
    const b = createEventBatcher({ flush, initialIntervalMs: 100 });
    b.push('x');
    b.dispose();
    vi.advanceTimersByTime(500);
    expect(flush).not.toHaveBeenCalled();
  });
});

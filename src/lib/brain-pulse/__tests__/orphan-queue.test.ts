import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createOrphanQueue } from '../orphan-queue';

describe('createOrphanQueue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('holds events for a key and releases them when resolveKey is called', () => {
    const release = vi.fn();
    const q = createOrphanQueue<string>({
      timeoutMs: 2000, onRelease: release, onDrop: vi.fn(),
    });
    q.enqueue({ key: 'doc-1', payload: 'x' });
    q.enqueue({ key: 'doc-1', payload: 'y' });
    q.enqueue({ key: 'doc-2', payload: 'z' });
    expect(release).not.toHaveBeenCalled();

    q.resolveKey('doc-1');
    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.calls.map((c) => c[0].payload)).toEqual(['x', 'y']);
  });

  it('drops events after timeoutMs if never resolved', () => {
    const drop = vi.fn();
    const q = createOrphanQueue<string>({
      timeoutMs: 2000, onRelease: vi.fn(), onDrop: drop,
    });
    q.enqueue({ key: 'doc-ghost', payload: '1' });
    vi.advanceTimersByTime(1999);
    expect(drop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it('dispose clears everything', () => {
    const drop = vi.fn();
    const release = vi.fn();
    const q = createOrphanQueue<string>({
      timeoutMs: 2000, onRelease: release, onDrop: drop,
    });
    q.enqueue({ key: 'k', payload: 'x' });
    q.dispose();
    vi.advanceTimersByTime(3000);
    expect(drop).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});

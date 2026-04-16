// Time-windowed batcher. Collects pushes, flushes at the configured
// interval, escalates to a longer interval under sustained load.

export interface EventBatcherOptions<T> {
  flush: (batch: T[]) => void;
  initialIntervalMs?: number;
  highLoadIntervalMs?: number;
  highLoadThreshold?: number;
}

export interface EventBatcher<T> {
  push: (evt: T) => void;
  dispose: () => void;
  peekIntervalMs: () => number;
}

export function createEventBatcher<T>(opts: EventBatcherOptions<T>): EventBatcher<T> {
  const initial = opts.initialIntervalMs ?? 100;
  const highLoad = opts.highLoadIntervalMs ?? 250;
  const threshold = opts.highLoadThreshold ?? 10;

  let queue: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentIntervalMs = initial;

  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(flushNow, currentIntervalMs);
  }

  function flushNow() {
    timer = null;
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    currentIntervalMs = batch.length >= threshold ? highLoad : initial;
    opts.flush(batch);
  }

  return {
    push(evt) { queue.push(evt); schedule(); },
    dispose() { if (timer !== null) { clearTimeout(timer); timer = null; } queue = []; },
    peekIntervalMs() { return currentIntervalMs; },
  };
}

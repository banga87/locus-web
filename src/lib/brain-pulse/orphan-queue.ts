// Events whose target isn't in the graph yet wait here.
//
// Release paths:
//  1. resolveKey(key) — SWR revalidation revealed the node; fire queued entries.
//  2. timeout — 2s without resolution -> drop.

export interface OrphanEntry<T> { key: string; payload: T }

export interface OrphanQueueOptions<T> {
  timeoutMs: number;
  onRelease: (entry: OrphanEntry<T>) => void;
  onDrop: (entry: OrphanEntry<T>) => void;
}

interface Timed<T> extends OrphanEntry<T> {
  timer: ReturnType<typeof setTimeout>;
}

export interface OrphanQueue<T> {
  enqueue: (entry: OrphanEntry<T>) => void;
  resolveKey: (key: string) => void;
  dispose: () => void;
}

export function createOrphanQueue<T>(opts: OrphanQueueOptions<T>): OrphanQueue<T> {
  const buckets = new Map<string, Timed<T>[]>();

  function enqueue(entry: OrphanEntry<T>) {
    // Build a placeholder so the timer closure can reference the final object.
    const timed = { ...entry } as Timed<T>;
    timed.timer = setTimeout(() => {
      const bucket = buckets.get(entry.key);
      if (!bucket) return;
      const idx = bucket.findIndex((e) => e === timed);
      if (idx >= 0) bucket.splice(idx, 1);
      if (bucket.length === 0) buckets.delete(entry.key);
      opts.onDrop(entry);
    }, opts.timeoutMs);
    const arr = buckets.get(entry.key) ?? [];
    arr.push(timed);
    buckets.set(entry.key, arr);
  }

  function resolveKey(key: string) {
    const bucket = buckets.get(key);
    if (!bucket) return;
    buckets.delete(key);
    for (const t of bucket) {
      clearTimeout(t.timer);
      opts.onRelease({ key: t.key, payload: t.payload });
    }
  }

  function dispose() {
    for (const bucket of buckets.values()) for (const t of bucket) clearTimeout(t.timer);
    buckets.clear();
  }

  return { enqueue, resolveKey, dispose };
}

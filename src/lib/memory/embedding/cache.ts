//
// In-process LRU for query embeddings. Avoids re-embedding identical
// queries within a single request lifecycle (e.g. an agent calling
// retrieve() three times with the same query). Cleared on process
// restart.
//
// Caveat per spec §5.5: under Vercel Functions' fluid compute,
// warm-instance lifetime varies — this is best-effort, not
// load-bearing. If query patterns prove repetitive in production,
// escalate to a Redis-backed cache.

export interface QueryEmbeddingCache {
  get(query: string): Promise<number[]>;
}

export interface CreateCacheOptions {
  max: number;
  embedder: (query: string) => Promise<number[]>;
}

export function createQueryEmbeddingCache(
  opts: CreateCacheOptions,
): QueryEmbeddingCache {
  // Map preserves insertion order; we re-insert on access to make it LRU.
  const store = new Map<string, number[]>();

  return {
    async get(query: string): Promise<number[]> {
      const hit = store.get(query);
      if (hit !== undefined) {
        // Re-insert to move to most-recently-used position.
        store.delete(query);
        store.set(query, hit);
        return hit;
      }
      const vec = await opts.embedder(query);
      store.set(query, vec);
      while (store.size > opts.max) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
      return vec;
    },
  };
}

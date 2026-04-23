import { describe, it, expect, beforeEach } from 'vitest';
import { createQueryEmbeddingCache } from '../cache';

describe('createQueryEmbeddingCache', () => {
  let calls: number;
  let cache: ReturnType<typeof createQueryEmbeddingCache>;
  const fakeEmbedder = async (q: string) => {
    calls++;
    return new Array(1536).fill(q.length);
  };

  beforeEach(() => {
    calls = 0;
    cache = createQueryEmbeddingCache({ max: 3, embedder: fakeEmbedder });
  });

  it('caches identical queries within capacity', async () => {
    const a1 = await cache.get('hello');
    const a2 = await cache.get('hello');
    expect(a1).toEqual(a2);
    expect(calls).toBe(1);
  });

  it('evicts the oldest entry when over capacity (LRU)', async () => {
    await cache.get('a');
    await cache.get('b');
    await cache.get('c');
    await cache.get('d'); // evicts 'a'
    expect(calls).toBe(4);
    await cache.get('a'); // miss again
    expect(calls).toBe(5);
    await cache.get('d'); // hit (most recently inserted)
    expect(calls).toBe(5);
  });

  it('treats different queries as different cache keys', async () => {
    await cache.get('apple');
    await cache.get('apples');
    await cache.get('Apple'); // case-sensitive
    expect(calls).toBe(3);
  });
});

import { describe, it, expect } from 'vitest';
import { tataraHybridProvider } from '../index';

describe('tataraHybridProvider.describe()', () => {
  it('reports the Phase 1 capability set', () => {
    const c = tataraHybridProvider.describe();
    expect(c.name).toBe('tatara-hybrid');
    expect(c.supports.factLookup).toBe(false);
    expect(c.supports.graphTraverse).toBe(false);
    expect(c.supports.timeline).toBe(false);
    expect(c.supports.embeddings).toBe(false);
  });
});

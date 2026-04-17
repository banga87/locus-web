import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_CATALOG,
  getCatalogEntry,
  validateCatalog,
} from '../catalog';

describe('connector catalog', () => {
  it('loads with known entries', () => {
    const ids = CONNECTOR_CATALOG.map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining(['linear', 'notion', 'sentry', 'github', 'stripe']),
    );
  });

  it('returns null for unknown ids', () => {
    expect(getCatalogEntry('does-not-exist')).toBeNull();
  });

  it('returns the entry for a known id', () => {
    const entry = getCatalogEntry('linear');
    expect(entry?.name).toBe('Linear');
    expect(entry?.mcpUrl).toMatch(/^https:\/\//);
  });

  it('rejects a duplicate id', () => {
    const dup = [
      { id: 'x', name: 'X', description: 'd', iconUrl: '/a.svg', mcpUrl: 'https://a', authMode: 'oauth-dcr' as const },
      { id: 'x', name: 'X2', description: 'd', iconUrl: '/b.svg', mcpUrl: 'https://b', authMode: 'oauth-dcr' as const },
    ];
    expect(() => validateCatalog(dup)).toThrow(/duplicate/);
  });

  it('rejects an unknown authMode', () => {
    const bad = [
      { id: 'x', name: 'X', description: 'd', iconUrl: '/a.svg', mcpUrl: 'https://a', authMode: 'weird' },
    ];
    expect(() => validateCatalog(bad as unknown as Parameters<typeof validateCatalog>[0])).toThrow();
  });
});

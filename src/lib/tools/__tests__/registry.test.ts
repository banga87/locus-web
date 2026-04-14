import { describe, it, expect, beforeEach } from 'vitest';
import { registerLocusTools, __resetLocusToolsRegistered } from '../index';
import { getAllTools, __resetRegistryForTests } from '../executor';

beforeEach(() => {
  __resetRegistryForTests();
  __resetLocusToolsRegistered();
});

describe('registerLocusTools', () => {
  it('registers web_search and web_fetch alongside brain tools', () => {
    registerLocusTools();
    const names = getAllTools().map((t) => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
    // Existing brain tools still registered.
    expect(names).toContain('search_documents');
    expect(names).toContain('get_document');
  });
});

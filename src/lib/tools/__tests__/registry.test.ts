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

  it('registers write tools create_document and update_document', () => {
    registerLocusTools();
    const names = getAllTools().map((t) => t.name);
    expect(names).toContain('create_document');
    expect(names).toContain('update_document');
  });

  it('write tools declare action=write and isReadOnly()=false', () => {
    registerLocusTools();
    const tools = getAllTools();
    const create = tools.find((t) => t.name === 'create_document');
    const update = tools.find((t) => t.name === 'update_document');
    expect(create?.action).toBe('write');
    expect(create?.isReadOnly()).toBe(false);
    expect(update?.action).toBe('write');
    expect(update?.isReadOnly()).toBe(false);
  });
});

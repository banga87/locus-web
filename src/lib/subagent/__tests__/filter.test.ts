import { describe, expect, it } from 'vitest';
import type { Tool } from 'ai';
import { filterSubagentTools } from '../filter';
import type { BuiltInAgentDefinition } from '../types';

const fakeTool = {} as Tool;
const allTools: Record<string, Tool> = {
  manifest_read: fakeTool,
  search_documents: fakeTool,
  get_document: fakeTool,
  write_document: fakeTool,
  update_frontmatter: fakeTool,
  Agent: fakeTool,
};

const def = (partial: Partial<BuiltInAgentDefinition>): BuiltInAgentDefinition =>
  ({
    agentType: 'Test',
    whenToUse: 'test',
    model: 'anthropic/claude-haiku-4.5',
    getSystemPrompt: () => '',
    ...partial,
  } as BuiltInAgentDefinition);

describe('filterSubagentTools', () => {
  it('always strips the Agent tool regardless of config', () => {
    const out = filterSubagentTools(allTools, def({}));
    expect(out.Agent).toBeUndefined();
  });

  it('applies an allowlist when tools is set', () => {
    const out = filterSubagentTools(allTools, def({
      tools: ['manifest_read', 'search_documents'],
    }));
    expect(Object.keys(out).sort()).toEqual(['manifest_read', 'search_documents']);
  });

  it('applies a denylist when disallowedTools is set', () => {
    const out = filterSubagentTools(allTools, def({
      disallowedTools: ['write_document', 'update_frontmatter'],
    }));
    expect(out.write_document).toBeUndefined();
    expect(out.update_frontmatter).toBeUndefined();
    expect(out.manifest_read).toBeDefined();
    expect(out.Agent).toBeUndefined(); // still stripped
  });

  it('allowlist + denylist: allow wins, denylist can still remove', () => {
    const out = filterSubagentTools(allTools, def({
      tools: ['manifest_read', 'write_document'],
      disallowedTools: ['write_document'],
    }));
    expect(Object.keys(out)).toEqual(['manifest_read']);
  });

  it('returns empty object when nothing remains', () => {
    const out = filterSubagentTools(allTools, def({ tools: [] }));
    expect(out).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { buildAgentToolDescription } from '../prompt';
import type { BuiltInAgentDefinition } from '../types';

const def = (overrides: Partial<BuiltInAgentDefinition>) =>
  ({
    agentType: 'X',
    whenToUse: 'x purpose',
    model: 'anthropic/claude-haiku-4.5',
    getSystemPrompt: () => '',
    ...overrides,
  } as BuiltInAgentDefinition);

describe('buildAgentToolDescription', () => {
  it('renders "no agents registered" when empty', () => {
    const desc = buildAgentToolDescription([]);
    expect(desc).toContain('no agents are currently registered');
  });

  it('lists each agent with its whenToUse and tool description', () => {
    const desc = buildAgentToolDescription([
      def({ agentType: 'BrainExplore', whenToUse: 'find docs', disallowedTools: ['write_document', 'Agent'] }),
    ]);
    expect(desc).toContain('BrainExplore');
    expect(desc).toContain('find docs');
    expect(desc).toMatch(/All tools except.*write_document/);
  });

  it('renders an allowlist explicitly', () => {
    const desc = buildAgentToolDescription([
      def({ agentType: 'Y', tools: ['manifest_read', 'search_documents'] }),
    ]);
    expect(desc).toContain('Tools: manifest_read, search_documents');
  });
});

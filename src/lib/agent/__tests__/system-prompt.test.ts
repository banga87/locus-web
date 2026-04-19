import { describe, it, expect } from 'vitest';

import { buildSystemPrompt } from '../system-prompt';
import type { ConnectionToolGroup } from '@/lib/mcp-out/bridge';

const brain = { name: 'Company Brain', slug: 'company-brain' } as const;
const folders = [{ slug: 'ops', name: 'Ops', description: 'Operations' }];

describe('buildSystemPrompt', () => {
  it('omits the external tools section when no connections are passed', () => {
    const out = buildSystemPrompt({
      brain,
      companyName: 'Acme',
      folders,
    });
    expect(out).not.toContain('Connected external tools');
  });

  it('omits the section when every connection discovered zero tools', () => {
    const groups: ConnectionToolGroup[] = [
      {
        connectionId: 'c1',
        connectionName: 'Linear',
        catalogId: 'linear',
        tools: [],
      },
    ];
    const out = buildSystemPrompt({
      brain,
      companyName: 'Acme',
      folders,
      externalConnections: groups,
    });
    expect(out).not.toContain('Connected external tools');
  });

  it('renders a grouped section per connection with tool keys + descriptions', () => {
    const groups: ConnectionToolGroup[] = [
      {
        connectionId: 'c1',
        connectionName: 'Linear',
        catalogId: 'linear',
        tools: [
          { key: 'ext_abc_list_teams', description: 'List teams in the workspace.' },
          { key: 'ext_abc_create_issue', description: 'Create a Linear issue.' },
        ],
      },
      {
        connectionId: 'c2',
        connectionName: 'Notion',
        catalogId: 'notion',
        tools: [{ key: 'ext_def_search', description: 'Search the workspace.' }],
      },
    ];
    const out = buildSystemPrompt({
      brain,
      companyName: 'Acme',
      folders,
      externalConnections: groups,
    });

    expect(out).toContain('## Connected external tools');
    expect(out).toContain('**Linear** (via MCP — `linear`)');
    expect(out).toContain('`ext_abc_list_teams`: List teams in the workspace.');
    expect(out).toContain('`ext_abc_create_issue`: Create a Linear issue.');
    expect(out).toContain('**Notion** (via MCP — `notion`)');
    expect(out).toContain('`ext_def_search`: Search the workspace.');
  });

  it('omits the catalog tag when catalogId is null (custom install)', () => {
    const groups: ConnectionToolGroup[] = [
      {
        connectionId: 'c1',
        connectionName: 'My Custom Server',
        catalogId: null,
        tools: [{ key: 'ext_abc_ping', description: 'Ping.' }],
      },
    ];
    const out = buildSystemPrompt({
      brain,
      companyName: 'Acme',
      folders,
      externalConnections: groups,
    });
    expect(out).toContain('**My Custom Server** (via MCP):');
    expect(out).not.toContain('**My Custom Server** (via MCP — `');
  });
});

describe('buildSystemPrompt availableSkills block', () => {
  const base = {
    brain: { name: 'Acme Brain', slug: 'acme' },
    companyName: 'Acme',
    folders: [],
  };

  it('omits the block when no skills are available', () => {
    const out = buildSystemPrompt({ ...base, availableSkills: [] });
    expect(out).not.toContain('<available-skills>');
  });

  it('omits the block when availableSkills is undefined', () => {
    const out = buildSystemPrompt({ ...base });
    expect(out).not.toContain('<available-skills>');
  });

  it('renders one entry per skill with id + name + description', () => {
    const out = buildSystemPrompt({
      ...base,
      availableSkills: [
        { id: 'abc', name: 'Test', description: 'Use when testing' },
      ],
    });
    expect(out).toContain('<available-skills>');
    expect(out).toContain('id: abc');
    expect(out).toContain('name: Test');
    expect(out).toContain('description: Use when testing');
    expect(out).toContain('</available-skills>');
  });

  it('collapses newlines in description', () => {
    const out = buildSystemPrompt({
      ...base,
      availableSkills: [
        { id: 'x', name: 'Multi', description: 'line one\nline two' },
      ],
    });
    expect(out).toContain('description: line one line two');
  });

  it('includes the skill-creator authoring nudge after the brain tools list', () => {
    // Task 32: the agent needs a pointer at `skill-creator` + `propose_skill_create`
    // so it knows how to codify a repeatable pattern. Rendered unconditionally
    // — doesn't depend on availableSkills, since the agent can still request
    // the skill by id via load_skill even if it's not in the visible list.
    const out = buildSystemPrompt({ ...base });
    expect(out).toContain("load_skill('skill-creator')");
    expect(out).toContain('propose_skill_create');
  });
});

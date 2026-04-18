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

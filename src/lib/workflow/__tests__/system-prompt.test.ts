// system-prompt.ts tests — snapshot + structural assertions.
//
// Pure unit tests: no DB, no mocks needed.

import { describe, expect, it } from 'vitest';
import { buildWorkflowSystemPrompt } from '../system-prompt';
import type { WorkflowFrontmatter } from '@/lib/brain/frontmatter';

const baseFrontmatter: WorkflowFrontmatter = {
  type: 'workflow',
  output: 'document',
  output_category: 'reports',
  requires_mcps: ['gmail', 'hubspot'],
  schedule: null,
};

describe('buildWorkflowSystemPrompt', () => {
  it('prepends the workflow preamble before the base prompt', () => {
    const result = buildWorkflowSystemPrompt(
      'BASE_PROMPT',
      baseFrontmatter,
      'workflows/my-workflow',
    );
    const baseIdx = result.indexOf('BASE_PROMPT');
    const preambleIdx = result.indexOf('Workflow execution mode');
    expect(preambleIdx).toBeGreaterThanOrEqual(0);
    expect(baseIdx).toBeGreaterThan(preambleIdx);
  });

  it('includes the workflow doc path', () => {
    const result = buildWorkflowSystemPrompt(
      'BASE',
      baseFrontmatter,
      'workflows/my-workflow',
    );
    expect(result).toContain('`workflows/my-workflow`');
  });

  it('includes the output type', () => {
    const result = buildWorkflowSystemPrompt('BASE', baseFrontmatter, 'w/w');
    expect(result).toContain('`document`');
    expect(result).toContain('a brain document');
  });

  it('includes MCP slugs', () => {
    const result = buildWorkflowSystemPrompt('BASE', baseFrontmatter, 'w/w');
    expect(result).toContain('`gmail`');
    expect(result).toContain('`hubspot`');
  });

  it('shows "none" when requires_mcps is empty', () => {
    const fm: WorkflowFrontmatter = { ...baseFrontmatter, requires_mcps: [] };
    const result = buildWorkflowSystemPrompt('BASE', fm, 'w/w');
    expect(result).toContain('none');
  });

  it('includes output_category when set', () => {
    const result = buildWorkflowSystemPrompt('BASE', baseFrontmatter, 'w/w');
    expect(result).toContain('`reports`');
  });

  it('omits output_category line when null', () => {
    const fm: WorkflowFrontmatter = { ...baseFrontmatter, output_category: null };
    const result = buildWorkflowSystemPrompt('BASE', fm, 'w/w');
    expect(result).not.toContain('filed in');
  });

  it('describes output=message correctly', () => {
    const fm: WorkflowFrontmatter = { ...baseFrontmatter, output: 'message' };
    const result = buildWorkflowSystemPrompt('BASE', fm, 'w/w');
    expect(result).toContain('a message response');
  });

  it('describes output=both correctly', () => {
    const fm: WorkflowFrontmatter = { ...baseFrontmatter, output: 'both' };
    const result = buildWorkflowSystemPrompt('BASE', fm, 'w/w');
    expect(result).toContain('a brain document and a message response');
  });

  it('matches snapshot', () => {
    const result = buildWorkflowSystemPrompt(
      'BASE_SYSTEM_PROMPT',
      baseFrontmatter,
      'workflows/my-workflow',
    );
    expect(result).toMatchInlineSnapshot(`
      "## Workflow execution mode

      You are executing the workflow defined in \`workflows/my-workflow\` autonomously. **There is no user present to respond to you.** Questions, clarifications, and requests for permission will not be answered — they will simply cause the run to end without producing output.

      **You must complete the workflow start to finish using only the tools available to you.** Do not ask for data the user could provide — fetch it with the tools. Do not ask for confirmation — proceed. Do not offer alternatives or propose placeholder output — produce the real declared output.

      If a required tool appears missing, first check the tools you were given: external MCP tools are exposed with namespaced keys (for example \`ext_<hex>_<remote_name>\`) rather than the server's bare name. Only if after inspection no tool can satisfy the step should you abort — and even then, produce the declared output document explaining what was missing, rather than asking.

      **Goal:** Produce a brain document as your final output. Stop once the declared output is produced — do not continue with unrelated tasks.

      **Output type:** \`document\`
      Output documents should be filed in the \`reports\` folder.
      **Required MCP connections:** \`gmail\`, \`hubspot\`

      Work through the instructions below step by step. Use your available tools to complete each step. When you have produced the declared output, stop.

      ---

      BASE_SYSTEM_PROMPT"
    `);
  });
});

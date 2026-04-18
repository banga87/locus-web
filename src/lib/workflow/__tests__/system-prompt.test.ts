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

      You are executing the workflow defined in \`workflows/my-workflow\`.

      **Goal:** Produce a brain document as your output. Stop once the declared output is produced — do not continue with unrelated tasks.

      **Output type:** \`document\`
      Output documents should be filed in the \`reports\` folder.
      **Required MCP connections:** \`gmail\`, \`hubspot\`

      Work through the instructions below step by step. Use your available tools to complete each step. When you have produced the declared output, stop.

      ---

      BASE_SYSTEM_PROMPT"
    `);
  });
});

// Workflow system prompt builder.
//
// Wraps the base brain system prompt (from src/lib/agent/system-prompt.ts)
// with a workflow-mode preamble so the agent understands it is executing a
// specific workflow rather than responding to a conversational turn.

import type { WorkflowFrontmatter } from '@/lib/brain/frontmatter';

/**
 * Build the system prompt for a workflow run. Prepends a workflow-mode
 * preamble to the supplied base prompt.
 *
 * @param basePrompt          Output of `buildSystemPrompt(...)` from
 *                            `src/lib/agent/system-prompt.ts`.
 * @param frontmatter         Validated `WorkflowFrontmatter` for the run.
 * @param workflowDocPath     Human-legible path of the workflow document
 *                            (e.g. "workflows/my-workflow"). Used in the
 *                            preamble so the agent can reference the
 *                            originating document.
 */
export function buildWorkflowSystemPrompt(
  basePrompt: string,
  frontmatter: WorkflowFrontmatter,
  workflowDocPath: string,
): string {
  const outputDesc =
    frontmatter.output === 'document'
      ? 'a brain document'
      : frontmatter.output === 'message'
        ? 'a message response'
        : 'a brain document and a message response';

  const mcpsDesc =
    frontmatter.requires_mcps.length > 0
      ? frontmatter.requires_mcps.map((s) => `\`${s}\``).join(', ')
      : 'none';

  const categoryDesc = frontmatter.output_category
    ? `\nOutput documents should be filed in the \`${frontmatter.output_category}\` folder.`
    : '';

  const preamble = `## Workflow execution mode

You are executing the workflow defined in \`${workflowDocPath}\`.

**Goal:** Produce ${outputDesc} as your output. Stop once the declared output is produced — do not continue with unrelated tasks.

**Output type:** \`${frontmatter.output}\`${categoryDesc}
**Required MCP connections:** ${mcpsDesc}

Work through the instructions below step by step. Use your available tools to complete each step. When you have produced the declared output, stop.

---

`;

  return preamble + basePrompt;
}

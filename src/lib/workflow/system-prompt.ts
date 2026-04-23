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

You are executing the workflow defined in \`${workflowDocPath}\` autonomously. **There is no user present to respond to you.** Questions, clarifications, and requests for permission will not be answered — they will simply cause the run to end without producing output.

**You must complete the workflow start to finish using only the tools available to you.** Do not ask for data the user could provide — fetch it with the tools. Do not ask for confirmation — proceed. Do not offer alternatives or propose placeholder output — produce the real declared output.

If a required tool appears missing, first check the tools you were given: external MCP tools are exposed with namespaced keys (for example \`ext_<hex>_<remote_name>\`) rather than the server's bare name. Only if after inspection no tool can satisfy the step should you abort — and even then, produce the declared output document explaining what was missing, rather than asking.

**Goal:** Produce ${outputDesc} as your final output. Stop once the declared output is produced — do not continue with unrelated tasks.

**Output type:** \`${frontmatter.output}\`${categoryDesc}
**Required MCP connections:** ${mcpsDesc}

Work through the instructions below step by step. Use your available tools to complete each step. When you have produced the declared output, stop.

---

`;

  return preamble + basePrompt;
}

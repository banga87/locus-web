// Triggered-skill system prompt builder.
//
// Wraps the base brain system prompt (from src/lib/agent/system-prompt.ts)
// with a triggered-skill preamble so the agent understands it is executing
// a specific skill autonomously rather than responding to a conversational
// turn.

import type { SkillTrigger } from '@/lib/brain/frontmatter';

/**
 * Build the system prompt for a triggered-skill run. Prepends a
 * triggered-skill preamble to the supplied base prompt.
 *
 * @param basePrompt       Output of `buildSystemPrompt(...)` from
 *                         `src/lib/agent/system-prompt.ts`.
 * @param trigger          Validated `SkillTrigger` for the run.
 * @param skillDocPath     Human-legible path of the skill document
 *                         (e.g. "skills/my-skill"). Used in the preamble
 *                         so the agent can reference the originating
 *                         document.
 */
export function buildTriggeredSkillSystemPrompt(
  basePrompt: string,
  trigger: SkillTrigger,
  skillDocPath: string,
): string {
  const outputDesc =
    trigger.output === 'document'
      ? 'a brain document'
      : trigger.output === 'message'
        ? 'a message response'
        : 'a brain document and a message response';

  const mcpsDesc =
    trigger.requires_mcps.length > 0
      ? trigger.requires_mcps.map((s) => `\`${s}\``).join(', ')
      : 'none';

  const categoryDesc = trigger.output_category
    ? `\nOutput documents should be filed in the \`${trigger.output_category}\` folder.`
    : '';

  const preamble = `## Triggered skill execution mode

You are executing the skill defined in \`${skillDocPath}\` autonomously. **There is no user present to respond to you.** Questions, clarifications, and requests for permission will not be answered — they will simply cause the run to end without producing output.

**You must complete the skill start to finish using only the tools available to you.** Do not ask for data the user could provide — fetch it with the tools. Do not ask for confirmation — proceed. Do not offer alternatives or propose placeholder output — produce the real declared output.

**You are the coordinator for this workflow.** Any step that requires pulling large amounts of data from external tools — MCP listings, bulk queries, multi-page reads, or anything that returns long tool responses — should be dispatched to a subagent via the \`Agent\` tool rather than called by you directly. The subagent's context absorbs the raw tool output and returns a compact summary to you. This keeps your own context focused on synthesis and the final output, not raw data wrangling. The available subagent types and their strengths are described in the \`Agent\` tool's description. Good triggers for delegation: listing or searching any external system, reading documents whose contents you will only summarise, and any step you can describe as "find X and tell me the important bits."

If a required tool appears missing, first check the tools you were given: external MCP tools are exposed with namespaced keys (for example \`ext_<hex>_<remote_name>\`) rather than the server's bare name. Only if after inspection no tool can satisfy the step should you abort — and even then, produce the declared output document explaining what was missing, rather than asking.

**Goal:** Produce ${outputDesc} as your final output. Stop once the declared output is produced — do not continue with unrelated tasks.

**Output type:** \`${trigger.output}\`${categoryDesc}
**Required MCP connections:** ${mcpsDesc}

Work through the instructions below step by step. Use your available tools (or dispatched subagents) to complete each step. When you have produced the declared output, stop.

---

`;

  return preamble + basePrompt;
}

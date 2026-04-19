import type { BuiltInAgentDefinition } from './types';

function formatToolsDescription(def: BuiltInAgentDefinition): string {
  if (def.tools && def.tools.length > 0) {
    return `Tools: ${def.tools.join(', ')}`;
  }
  if (def.disallowedTools && def.disallowedTools.length > 0) {
    return `All tools except ${def.disallowedTools.join(', ')}`;
  }
  return 'All tools';
}

function formatAgentLine(def: BuiltInAgentDefinition): string {
  return `- ${def.agentType}: ${def.whenToUse} (${formatToolsDescription(def)})`;
}

export function buildAgentToolDescription(
  agents: BuiltInAgentDefinition[],
): string {
  const listing = agents.length === 0
    ? '_(no agents are currently registered)_'
    : agents.map(formatAgentLine).join('\n');

  return `Launch a new agent to handle complex, multi-step tasks autonomously.

The Agent tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
${listing}

When using the Agent tool, specify a subagent_type parameter to select which agent type to use.

Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- The subagent starts fresh — brief it like a colleague who hasn't seen this conversation
- Subagent output is not visible to the user; summarize its findings in your own reply
- Launch multiple agents concurrently when tasks are independent — single message, multiple tool calls

Writing the prompt:
- Explain what you're trying to accomplish and why
- Describe what you've already learned or ruled out
- If you need a short response, say so ("report in under 200 words")
- Never delegate understanding — include document slugs, doc ids, and specifics rather than pushing synthesis onto the subagent`;
}

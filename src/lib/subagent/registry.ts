import type { BuiltInAgentDefinition } from './types';

// Built-in agents registered here. Add new built-ins by importing the
// definition from ./built-in/<slug>Agent.ts and pushing into this array.
// Order affects the Agent tool description rendering — most-used first.
const BUILT_IN_AGENTS: BuiltInAgentDefinition[] = [
  // BRAIN_EXPLORE_AGENT registered in Task 13.
];

export function getBuiltInAgents(): BuiltInAgentDefinition[] {
  return [...BUILT_IN_AGENTS];
}

export function getBuiltInAgent(
  agentType: string,
): BuiltInAgentDefinition | undefined {
  return BUILT_IN_AGENTS.find((a) => a.agentType === agentType);
}

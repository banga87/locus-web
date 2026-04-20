import { describe, expect, it } from 'vitest';
import { getBuiltInAgents, getBuiltInAgent } from '../registry';

describe('registry', () => {
  it('returns an array of BuiltInAgentDefinitions', () => {
    const agents = getBuiltInAgents();
    expect(Array.isArray(agents)).toBe(true);
  });

  it('each agent has a unique agentType', () => {
    const agents = getBuiltInAgents();
    const types = agents.map((a) => a.agentType);
    expect(new Set(types).size).toBe(types.length);
  });

  it('getBuiltInAgent returns undefined for unknown types', () => {
    expect(getBuiltInAgent('NoSuchAgent')).toBeUndefined();
  });

  // BrainExplore registration is asserted in Task 13's brainExploreAgent.test.ts.
});

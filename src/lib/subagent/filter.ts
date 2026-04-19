// Filter buildToolSet's output according to a BuiltInAgentDefinition's
// allow/deny lists. The Agent tool itself is ALWAYS stripped — subagents
// cannot spawn further subagents regardless of config. This preserves the
// §4 harness-boundary guarantee: buildToolSet is called unchanged; we
// wrap its output here inside src/lib/subagent/.

import type { Tool } from 'ai';
import type { BuiltInAgentDefinition } from './types';

const AGENT_TOOL_NAME = 'Agent';

export function filterSubagentTools(
  fullToolset: Record<string, Tool>,
  def: BuiltInAgentDefinition,
): Record<string, Tool> {
  const allow = def.tools ? new Set(def.tools) : null;
  const deny = new Set(def.disallowedTools ?? []);
  deny.add(AGENT_TOOL_NAME);

  const out: Record<string, Tool> = {};
  for (const [name, tool] of Object.entries(fullToolset)) {
    if (allow && !allow.has(name)) continue;
    if (deny.has(name)) continue;
    out[name] = tool;
  }
  return out;
}

// Derive the capability set a turn's tools should see. Lives in the route
// layer — NOT in `src/lib/agent/` — because it encodes route-specific
// policy (Platform Agent default, agent-definition override) that the
// harness must stay agnostic of.

import type { AgentActor } from '@/lib/agent/types';

interface DeriveArgs {
  actor: AgentActor;
  /**
   * The agent-definition doc's parsed `capabilities` field, loaded
   * separately (see `AgentCapabilitiesRepo.getAgentCapabilities`).
   * - null: no agent-definition in play (default Platform Agent).
   * - []:   agent-definition exists but didn't declare capabilities.
   * - ['web', ...]: explicit opt-in list.
   */
  agentCapabilities: string[] | null;
}

/**
 * v1 policy:
 *   Platform Agent (no agent-definition) → ['web'] (built-in default).
 *   Platform Agent with agent-definition → exactly what the definition declares.
 *   Autonomous / maintenance agents → [] (web disabled in v1).
 */
export function deriveGrantedCapabilities(args: DeriveArgs): string[] {
  if (args.actor.type === 'platform_agent') {
    if (args.agentCapabilities === null) return ['web'];
    return args.agentCapabilities;
  }
  return [];
}

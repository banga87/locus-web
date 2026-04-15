// Shared types for brain-pulse hook + components.
//
// Kept separate from src/lib/audit/types.ts because this module models
// the *client-side* realtime projection — post-filtering, with derived
// agent identity and typed details variants.

import type {
  GraphResponse, GraphNode, GraphEdge, GraphCluster, GraphMcpConnection,
} from '@/lib/graph/derive-graph';

export type { GraphResponse, GraphNode, GraphEdge, GraphCluster, GraphMcpConnection };

export type ActorType = 'human' | 'agent_token' | 'system';

export interface AgentIdentity {
  id: string;
  type: ActorType;
  name: string;
  color: { css: string; canvas: string };
}

export type VisibleCategory = 'document_access' | 'document_mutation' | 'mcp_invocation';

export interface BrainPulseEventBase {
  id: string;
  createdAt: Date;
  companyId: string;
  brainId: string | null;
  actorType: ActorType;
  actorId: string;
  actorName: string;
  targetType: string | null;
  targetId: string | null;
  category: VisibleCategory;
  eventType: string;
  details: Record<string, unknown>;
}

export interface Pulse {
  id: string;
  nodeId: string;
  agentId: string;
  category: VisibleCategory;
  eventType: string;
  createdAt: number;
  durationMs: number;
}

export interface McpCallLine {
  id: string;
  invocationId: string;
  originNodeId: string | null;
  mcpConnectionId: string;
  agentId: string;
  startedAt: number;
  completedAt: number | null;
}

export interface ActiveAgent {
  id: string;
  type: ActorType;
  name: string;
  color: { css: string; canvas: string };
  countLast60s: number;
  lastSeenAt: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'paused';

export interface BrainPulseState {
  graph: GraphResponse;
  events: BrainPulseEventBase[];
  pulses: Pulse[];
  mcpCallLines: McpCallLine[];
  activeAgents: ActiveAgent[];
  mcpConnections: GraphMcpConnection[];
  eventRate60s: number;
  connectionStatus: ConnectionStatus;
  graphError: Error | null;
  retryGraph: () => void;
}

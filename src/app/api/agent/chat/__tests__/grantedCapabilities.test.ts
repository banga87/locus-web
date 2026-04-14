import { describe, expect, it } from 'vitest';
import { deriveGrantedCapabilities } from '../grantedCapabilities';
import type { AgentActor } from '@/lib/agent/types';

const platformActor: AgentActor = {
  type: 'platform_agent',
  userId: 'u1',
  companyId: 'c1',
  scopes: ['read'],
};

const autonomousActor: AgentActor = {
  type: 'autonomous_agent',
  userId: null,
  companyId: 'c1',
  scopes: ['read'],
};

const maintenanceActor: AgentActor = {
  type: 'maintenance_agent',
  userId: null,
  companyId: 'c1',
  scopes: ['read'],
};

describe('deriveGrantedCapabilities', () => {
  it('defaults to ["web"] for a Platform Agent with no agent-definition', () => {
    expect(deriveGrantedCapabilities({ actor: platformActor, agentCapabilities: null })).toEqual(['web']);
  });

  it('returns exactly the agent-definition capabilities for a Platform Agent with one', () => {
    expect(deriveGrantedCapabilities({ actor: platformActor, agentCapabilities: ['web'] })).toEqual(['web']);
    expect(deriveGrantedCapabilities({ actor: platformActor, agentCapabilities: [] })).toEqual([]);
    expect(deriveGrantedCapabilities({ actor: platformActor, agentCapabilities: ['web', 'writes'] })).toEqual(['web', 'writes']);
  });

  it('returns [] for autonomous_agent regardless of agent-definition caps', () => {
    expect(deriveGrantedCapabilities({ actor: autonomousActor, agentCapabilities: null })).toEqual([]);
    expect(deriveGrantedCapabilities({ actor: autonomousActor, agentCapabilities: ['web'] })).toEqual([]);
  });

  it('returns [] for maintenance_agent regardless of agent-definition caps', () => {
    expect(deriveGrantedCapabilities({ actor: maintenanceActor, agentCapabilities: null })).toEqual([]);
    expect(deriveGrantedCapabilities({ actor: maintenanceActor, agentCapabilities: ['web'] })).toEqual([]);
  });
});

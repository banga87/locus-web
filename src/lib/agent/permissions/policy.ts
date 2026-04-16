// src/lib/agent/permissions/policy.ts
//
// Pure function policy matrix. No I/O, no Next.js, no DB — this file
// must stay importable from the harness (src/lib/agent/).

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type Action = 'read' | 'write';

interface Actor {
  role: Role;
}

interface PolicyRequest {
  action: Action;
}

const WRITE_ALLOWED: ReadonlySet<Role> = new Set(['owner', 'admin', 'editor']);

export function policyAllows(actor: Actor, req: PolicyRequest): boolean {
  if (req.action === 'read') return true; // all authenticated roles may read
  if (req.action === 'write') return WRITE_ALLOWED.has(actor.role);
  // Exhaustive — TS flags new actions.
  const _exhaustive: never = req.action;
  return false;
}

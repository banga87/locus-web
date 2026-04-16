// src/lib/agent/permissions/evaluator.ts
//
// Thin wrapper over the policy matrix. Exists to evolve — today it's
// role-only; Phase 2 adds category/scope matching, approval flags, etc.
//
// Accepts a minimal context shape (only the fields it actually uses) so it
// stays testable and decoupled from the full AgentContext. The executor
// passes a compatible subset when it calls evaluate().

import { policyAllows, type Action, type Role } from './policy';

export class PermissionDeniedError extends Error {
  constructor(
    public readonly action: Action,
    public readonly resourceType: string,
  ) {
    super(`Permission denied: ${action} on ${resourceType}`);
    this.name = 'PermissionDeniedError';
  }
}

/** Minimum context the evaluator needs. AgentContext satisfies this once role is present. */
export interface EvalContext {
  actor: { role: Role };
  brainId: string;
}

export interface EvalRequest {
  action: Action;
  resourceType: 'document' | 'workflow' | 'session';
}

export function evaluate(ctx: EvalContext, req: EvalRequest): void {
  if (!policyAllows(ctx.actor, req)) {
    throw new PermissionDeniedError(req.action, req.resourceType);
  }
}

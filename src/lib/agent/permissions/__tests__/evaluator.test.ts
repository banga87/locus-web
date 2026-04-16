import { describe, it, expect } from 'vitest';
import { evaluate, PermissionDeniedError } from '../evaluator';

describe('evaluator', () => {
  it('passes through when policy allows', () => {
    const ctx = { actor: { role: 'editor' as const }, brainId: 'b1' };
    expect(() => evaluate(ctx, { action: 'write', resourceType: 'document' })).not.toThrow();
  });

  it('throws PermissionDeniedError when policy denies', () => {
    const ctx = { actor: { role: 'viewer' as const }, brainId: 'b1' };
    expect(() => evaluate(ctx, { action: 'write', resourceType: 'document' }))
      .toThrow(PermissionDeniedError);
  });
});

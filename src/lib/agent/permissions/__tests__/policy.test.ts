import { describe, it, expect } from 'vitest';
import { policyAllows } from '../policy';

describe('policy matrix', () => {
  it('allows Owner to write', () => {
    expect(policyAllows({ role: 'owner' }, { action: 'write' })).toBe(true);
  });

  it('allows Editor to write', () => {
    expect(policyAllows({ role: 'editor' }, { action: 'write' })).toBe(true);
  });

  it('denies Viewer from writing', () => {
    expect(policyAllows({ role: 'viewer' }, { action: 'write' })).toBe(false);
  });

  it('allows all roles to read', () => {
    expect(policyAllows({ role: 'viewer' }, { action: 'read' })).toBe(true);
    expect(policyAllows({ role: 'editor' }, { action: 'read' })).toBe(true);
    expect(policyAllows({ role: 'owner' }, { action: 'read' })).toBe(true);
  });
});

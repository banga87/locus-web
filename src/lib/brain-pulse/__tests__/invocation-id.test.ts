import { describe, it, expect } from 'vitest';
import { generateInvocationId } from '../invocation-id';

describe('generateInvocationId', () => {
  it('returns a valid UUID v4 string', () => {
    const id = generateInvocationId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('returns a unique value each call', () => {
    const a = generateInvocationId();
    const b = generateInvocationId();
    expect(a).not.toBe(b);
  });
});

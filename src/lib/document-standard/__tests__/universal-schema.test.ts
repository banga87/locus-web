import { describe, expect, it } from 'vitest';
import { universalSchema, validateUniversal } from '../universal-schema';

describe('universalSchema', () => {
  const valid = {
    id: 'doc-001',
    title: 'Brand voice',
    type: 'canonical',
    source: 'human:angus',
    topics: ['brand', 'voice'],
    confidence: 'high',
    status: 'active',
  };

  it('accepts a well-formed universal block', () => {
    const result = universalSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts a reserved type (e.g. skill)', () => {
    const result = universalSchema.safeParse({ ...valid, type: 'skill' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const result = validateUniversal({ ...valid, type: 'novel' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'type')).toBe(true);
    }
  });

  it('rejects a missing required field', () => {
    const { confidence: _omit, ...rest } = valid;
    const result = validateUniversal(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'confidence')).toBe(true);
    }
  });

  it('rejects topics that are not strings', () => {
    const result = validateUniversal({ ...valid, topics: ['ok', 5] });
    expect(result.ok).toBe(false);
  });

  it('rejects more than 5 topics', () => {
    const result = validateUniversal({
      ...valid,
      topics: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /1.*5/.test(e.message))).toBe(true);
    }
  });

  it('rejects a source string with no recognised prefix', () => {
    const result = validateUniversal({ ...valid, source: 'unknown-actor' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'source')).toBe(true);
    }
  });

  it('accepts agent:maintenance and human:<x> sources', () => {
    expect(
      validateUniversal({ ...valid, source: 'agent:maintenance' }).ok,
    ).toBe(true);
    expect(validateUniversal({ ...valid, source: 'human:angus' }).ok).toBe(
      true,
    );
  });
});

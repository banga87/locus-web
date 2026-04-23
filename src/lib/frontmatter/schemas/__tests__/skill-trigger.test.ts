import { describe, it, expect } from 'vitest';
import { triggerSchema } from '../skill-trigger';
import { getSchema, schemaRegistry } from '..';

describe('triggerSchema', () => {
  it('exposes the canonical default value', () => {
    expect(triggerSchema.defaults()).toEqual({
      output: 'document',
      output_category: null,
      requires_mcps: [],
      schedule: null,
    });
  });

  it('carries the skill-trigger sentinel and Trigger label', () => {
    expect(triggerSchema.type).toBe('skill-trigger');
    expect(triggerSchema.label).toBe('Trigger');
  });

  it('validates a good value without requiring `type`', () => {
    const r = triggerSchema.validate({
      output: 'message',
      output_category: 'Reports',
      requires_mcps: ['sentry'],
      schedule: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toHaveProperty('type');
      expect(r.value).toEqual({
        output: 'message',
        output_category: 'Reports',
        requires_mcps: ['sentry'],
        schedule: null,
      });
    }
  });

  it('rejects invalid output', () => {
    const r = triggerSchema.validate({
      output: 'banana',
      output_category: null,
      requires_mcps: [],
      schedule: null,
    });
    expect(r.ok).toBe(false);
  });

  it('has four fields in spec-declared order', () => {
    expect(triggerSchema.fields.map((f) => f.name)).toEqual([
      'output',
      'output_category',
      'requires_mcps',
      'schedule',
    ]);
  });
});

describe('schema registry', () => {
  it('has no entries — skill frontmatter is user-authored', () => {
    expect(Object.keys(schemaRegistry)).toEqual([]);
  });

  it('returns null for skill type (no panel-driven schema)', () => {
    expect(getSchema('skill')).toBeNull();
  });

  it('returns null for the old workflow type', () => {
    expect(getSchema('workflow')).toBeNull();
  });

  it('returns null for unknown types', () => {
    expect(getSchema('not-a-type')).toBeNull();
  });

  it('returns null when the input type is null', () => {
    expect(getSchema(null)).toBeNull();
  });

  it('returns null when the input type is an empty string', () => {
    expect(getSchema('')).toBeNull();
  });
});

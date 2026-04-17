import { describe, it, expect } from 'vitest';
import { workflowSchema } from '../workflow';
import { getSchema, schemaRegistry } from '..';

describe('workflowSchema', () => {
  it('exposes the canonical default value', () => {
    expect(workflowSchema.defaults()).toEqual({
      output: 'document',
      output_category: null,
      requires_mcps: [],
      schedule: null,
    });
  });

  it('validates a good value without requiring `type`', () => {
    const r = workflowSchema.validate({
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
    const r = workflowSchema.validate({
      output: 'banana',
      output_category: null,
      requires_mcps: [],
      schedule: null,
    });
    expect(r.ok).toBe(false);
  });

  it('has four fields in spec-declared order', () => {
    expect(workflowSchema.fields.map((f) => f.name)).toEqual([
      'output',
      'output_category',
      'requires_mcps',
      'schedule',
    ]);
  });
});

describe('schema registry', () => {
  it('resolves workflow by type', () => {
    expect(getSchema('workflow')).toBe(workflowSchema);
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

  it('contains workflow in the registry map', () => {
    expect(schemaRegistry.workflow).toBe(workflowSchema);
  });
});

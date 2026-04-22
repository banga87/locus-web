import { describe, it, expect } from 'vitest';
import { workflowSchema } from '../workflow';

describe('workflowSchema — agent field', () => {
  const baseInput = {
    output: 'document' as const,
    output_category: null,
    requires_mcps: [],
    schedule: null,
  };

  it('defaults() includes agent: null', () => {
    const d = workflowSchema.defaults();
    expect(d).toHaveProperty('agent', null);
  });

  it('fields array includes an agent entry with correct shape', () => {
    const agentField = workflowSchema.fields.find((f) => f.name === 'agent');
    expect(agentField).toBeDefined();
    expect(agentField?.kind).toBe('nullable-string');
    expect(agentField?.label).toBe('Run as');
    expect((agentField as { placeholder?: string })?.placeholder).toBe('platform-agent');
  });

  it('validate: absent agent → ok, agent null in output', () => {
    const r = workflowSchema.validate({ ...baseInput });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveProperty('agent', null);
  });

  it('validate: explicit null agent → ok, agent null in output', () => {
    const r = workflowSchema.validate({ ...baseInput, agent: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveProperty('agent', null);
  });

  it('validate: "platform-agent" → ok, normalised to null in output', () => {
    const r = workflowSchema.validate({ ...baseInput, agent: 'platform-agent' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveProperty('agent', null);
  });

  it('validate: valid slug → ok, slug preserved in output', () => {
    const r = workflowSchema.validate({ ...baseInput, agent: 'my-custom-agent' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveProperty('agent', 'my-custom-agent');
  });

  it('validate: invalid agent (empty string) → not ok', () => {
    const r = workflowSchema.validate({ ...baseInput, agent: '' });
    expect(r.ok).toBe(false);
  });

  it('validate: invalid agent (bad chars) → not ok', () => {
    const r = workflowSchema.validate({ ...baseInput, agent: 'Bad Agent!' });
    expect(r.ok).toBe(false);
  });

  it('round-trip: value output does not include `type` key', () => {
    const r = workflowSchema.validate({ ...baseInput, agent: 'some-agent' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).not.toHaveProperty('type');
  });
});

import { describe, it, expect } from 'vitest';
import { validateWorkflowFrontmatter } from '../frontmatter';

describe('workflow frontmatter', () => {
  it('accepts valid workflow frontmatter', () => {
    const res = validateWorkflowFrontmatter({
      type: 'workflow',
      output: 'document',
      output_category: 'Reports',
      requires_mcps: ['sentry'],
      schedule: null,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects unknown output value', () => {
    const res = validateWorkflowFrontmatter({ type: 'workflow', output: 'banana' as never });
    expect(res.ok).toBe(false);
  });

  it('rejects missing output when type=workflow', () => {
    const res = validateWorkflowFrontmatter({ type: 'workflow' } as never);
    expect(res.ok).toBe(false);
  });

  it('treats schedule as optional/nullable', () => {
    const res = validateWorkflowFrontmatter({
      type: 'workflow',
      output: 'message',
      requires_mcps: [],
    });
    expect(res.ok).toBe(true);
  });

  it('accepts output: both', () => {
    const res = validateWorkflowFrontmatter({
      type: 'workflow',
      output: 'both',
      requires_mcps: [],
    });
    expect(res.ok).toBe(true);
  });
});

describe('workflow frontmatter — agent field', () => {
  const base = {
    type: 'workflow',
    output: 'document',
    requires_mcps: [],
  } as const;

  it('absent agent → ok, value.agent === null', () => {
    const res = validateWorkflowFrontmatter({ ...base });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.agent).toBeNull();
  });

  it('explicit null → ok, value.agent === null', () => {
    const res = validateWorkflowFrontmatter({ ...base, agent: null });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.agent).toBeNull();
  });

  it('reserved literal "platform-agent" → ok, normalised to null', () => {
    const res = validateWorkflowFrontmatter({ ...base, agent: 'platform-agent' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.agent).toBeNull();
  });

  it('valid slug string → ok, value.agent preserved', () => {
    const res = validateWorkflowFrontmatter({ ...base, agent: 'my-scoped-agent' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.agent).toBe('my-scoped-agent');
  });

  it('empty string → not ok, error on field "agent"', () => {
    const res = validateWorkflowFrontmatter({ ...base, agent: '' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.field === 'agent')).toBe(true);
  });

  it('uppercase + space slug → not ok, error on field "agent"', () => {
    const res = validateWorkflowFrontmatter({ ...base, agent: 'Bad Slug' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.field === 'agent')).toBe(true);
  });

  it('non-string (number) → not ok, error on field "agent"', () => {
    const res = validateWorkflowFrontmatter({ ...base, agent: 42 as unknown as string });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.field === 'agent')).toBe(true);
  });

  it('129-char string → not ok, error on field "agent"', () => {
    const longSlug = 'a'.repeat(129);
    const res = validateWorkflowFrontmatter({ ...base, agent: longSlug });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.field === 'agent')).toBe(true);
  });
});

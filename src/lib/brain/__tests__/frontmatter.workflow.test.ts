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


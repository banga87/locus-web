import { describe, it, expect } from 'vitest';
import { validateSkillTrigger } from '../frontmatter';

describe('skill trigger frontmatter', () => {
  it('accepts a valid trigger block', () => {
    const res = validateSkillTrigger({
      output: 'document',
      output_category: 'Reports',
      requires_mcps: ['sentry'],
      schedule: null,
    });
    expect(res.ok).toBe(true);
  });

  it('rejects unknown output value', () => {
    const res = validateSkillTrigger({ output: 'banana', requires_mcps: [] });
    expect(res.ok).toBe(false);
  });

  it('rejects missing output', () => {
    const res = validateSkillTrigger({ requires_mcps: [] });
    expect(res.ok).toBe(false);
  });

  it('treats schedule as optional/nullable', () => {
    const res = validateSkillTrigger({
      output: 'message',
      requires_mcps: [],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.schedule).toBeNull();
      expect(res.value.output_category).toBeNull();
    }
  });

  it('accepts output: both', () => {
    const res = validateSkillTrigger({
      output: 'both',
      requires_mcps: [],
    });
    expect(res.ok).toBe(true);
  });

  it('does NOT check a top-level type field', () => {
    // A stray `type` key on the trigger block is ignored — the trigger is a
    // nested block under a skill doc; the doc's `type: skill` lives at the
    // outer frontmatter level, not here.
    const res = validateSkillTrigger({
      type: 'anything',
      output: 'document',
      requires_mcps: [],
    });
    expect(res.ok).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(validateSkillTrigger(null).ok).toBe(false);
    expect(validateSkillTrigger('string').ok).toBe(false);
    expect(validateSkillTrigger(42).ok).toBe(false);
  });

  it('rejects requires_mcps that is not an array', () => {
    const res = validateSkillTrigger({
      output: 'document',
      requires_mcps: 'sentry',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects requires_mcps with non-string items', () => {
    const res = validateSkillTrigger({
      output: 'document',
      requires_mcps: ['sentry', 42],
    });
    expect(res.ok).toBe(false);
  });
});

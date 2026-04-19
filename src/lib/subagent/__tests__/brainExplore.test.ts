import { describe, expect, it } from 'vitest';
import { BRAIN_EXPLORE_AGENT } from '../built-in/brainExploreAgent';

const validator = BRAIN_EXPLORE_AGENT.outputContract!.validator!;

describe('BRAIN_EXPLORE_AGENT validator', () => {
  it('accepts properly formatted Sources block', () => {
    const txt = `
1. Answer: short answer.

2. Sources
   - Pricing Runbook — slug: \`pricing-runbook\` — id: \`uuid-1\`
   - Onboarding Checklist — slug: \`onboarding\` — id: \`uuid-2\`
`;
    expect(validator(txt)).toEqual({ ok: true });
  });

  it('rejects a Sources bullet missing slug', () => {
    const txt = `
2. Sources
   - Foo — id: \`uuid-1\`
`;
    expect(validator(txt).ok).toBe(false);
  });

  it('rejects a Sources bullet missing id', () => {
    const txt = `
2. Sources
   - Foo — slug: \`foo\`
`;
    expect(validator(txt).ok).toBe(false);
  });

  it('does not false-positive on prose mentioning slug or id outside Sources', () => {
    const txt = `
1. Answer: Use id fields for referencing. Every doc has a slug.

2. Sources
   - Foo — slug: \`foo\` — id: \`uuid-1\`
`;
    expect(validator(txt)).toEqual({ ok: true });
  });

  it('rejects when no Sources section is present', () => {
    expect(validator('1. Answer: hi').ok).toBe(false);
  });
});

describe('BRAIN_EXPLORE_AGENT config', () => {
  it('uses Haiku 4.5 as default', () => {
    expect(BRAIN_EXPLORE_AGENT.model).toBe('anthropic/claude-haiku-4.5');
  });
  it('denies write tools', () => {
    expect(BRAIN_EXPLORE_AGENT.disallowedTools).toEqual(
      expect.arrayContaining(['write_document', 'update_frontmatter', 'delete_document', 'create_document', 'Agent']),
    );
  });
  it('omits brain context', () => {
    expect(BRAIN_EXPLORE_AGENT.omitBrainContext).toBe(true);
  });
  it('sets maxTurns for 200+ doc brains', () => {
    expect(BRAIN_EXPLORE_AGENT.maxTurns).toBe(30);
  });
});

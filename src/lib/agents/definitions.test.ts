// Unit tests for the agent-definition wizard schema + service.
//
// Covers Task 4 Step 1 of the Phase 1.5 Context Injection plan.
// - `agentWizardInputSchema` — minimal-valid / invalid-slug / bad-model.
// - `buildAgentDefinitionDoc` — frontmatter shape + serialised markdown
//   wrapper.

import { describe, it, expect } from 'vitest';

import { agentWizardInputSchema } from './wizard-schema';
import { buildAgentDefinitionDoc } from './definitions';

describe('agent wizard input validation', () => {
  it('accepts a minimal valid input', () => {
    const result = agentWizardInputSchema.safeParse({
      title: 'Marketing Copywriter',
      slug: 'marketing-copywriter',
      model: 'claude-sonnet-4-6',
      baselineDocIds: [],
      skillIds: [],
      systemPromptSnippet: 'You are a copywriter.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid slug', () => {
    const result = agentWizardInputSchema.safeParse({
      title: 'A',
      slug: 'Invalid Slug With Spaces',
      model: 'claude-sonnet-4-6',
      baselineDocIds: [],
      skillIds: [],
      systemPromptSnippet: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects disallowed model', () => {
    const result = agentWizardInputSchema.safeParse({
      title: 'A',
      slug: 'a',
      model: 'gpt-4' as never,
      baselineDocIds: [],
      skillIds: [],
      systemPromptSnippet: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('buildAgentDefinitionDoc', () => {
  it('produces markdown with type=agent-definition frontmatter', () => {
    const doc = buildAgentDefinitionDoc({
      title: 'Marketing Copywriter',
      slug: 'marketing-copywriter',
      model: 'claude-sonnet-4-6',
      baselineDocIds: ['a7f3c2e4-1'],
      skillIds: ['c9f5e4a6-1'],
      systemPromptSnippet: 'You are a copywriter.',
    });
    expect(doc.content).toMatch(/^---\n/);
    expect(doc.content).toMatch(/type: agent-definition/);
    expect(doc.content).toMatch(/slug: marketing-copywriter/);
    expect(doc.frontmatter.type).toBe('agent-definition');
  });
});

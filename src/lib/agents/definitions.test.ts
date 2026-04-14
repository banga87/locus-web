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
      capabilities: [],
    });
    expect(doc.content).toMatch(/^---\n/);
    expect(doc.content).toMatch(/type: agent-definition/);
    expect(doc.content).toMatch(/slug: marketing-copywriter/);
    expect(doc.frontmatter.type).toBe('agent-definition');
  });
});

describe('agent-definition capabilities', () => {
  it('wizardSchema accepts capabilities: ["web"]', () => {
    const parsed = agentWizardInputSchema.parse({
      title: 'Blog Writer',
      slug: 'blog-writer',
      model: 'claude-sonnet-4-6',
      baselineDocIds: [],
      skillIds: [],
      systemPromptSnippet: '',
      capabilities: ['web'],
    });
    expect(parsed.capabilities).toEqual(['web']);
  });

  it('wizardSchema defaults capabilities to [] when absent', () => {
    const parsed = agentWizardInputSchema.parse({
      title: 'Blog Writer',
      slug: 'blog-writer',
      model: 'claude-sonnet-4-6',
      baselineDocIds: [],
      skillIds: [],
      systemPromptSnippet: '',
    });
    expect(parsed.capabilities).toEqual([]);
  });

  it('wizardSchema rejects unknown capability labels', () => {
    const result = agentWizardInputSchema.safeParse({
      title: 'Blog Writer',
      slug: 'blog-writer',
      model: 'claude-sonnet-4-6',
      baselineDocIds: [],
      skillIds: [],
      systemPromptSnippet: '',
      capabilities: ['bogus'],
    });
    expect(result.success).toBe(false);
  });

  it('buildAgentDefinitionDoc serialises capabilities into YAML frontmatter', () => {
    const doc = buildAgentDefinitionDoc({
      title: 'Web Researcher',
      slug: 'web-researcher',
      model: 'claude-sonnet-4-6',
      baselineDocIds: [],
      skillIds: [],
      systemPromptSnippet: '',
      capabilities: ['web'],
    });
    // Frontmatter object exposes the array.
    expect(doc.frontmatter.capabilities).toEqual(['web']);
    // Markdown includes the key under the YAML block.
    expect(doc.content).toMatch(/capabilities:/);
    expect(doc.content).toMatch(/- web/);
  });

  it('buildAgentDefinitionDoc emits capabilities even when empty (for round-trip stability)', () => {
    const doc = buildAgentDefinitionDoc({
      title: 'No-Web Agent',
      slug: 'no-web',
      model: 'claude-sonnet-4-6',
      baselineDocIds: [],
      skillIds: [],
      systemPromptSnippet: '',
      capabilities: [],
    });
    expect(doc.frontmatter.capabilities).toEqual([]);
    expect(doc.content).toMatch(/capabilities:/);
  });
});

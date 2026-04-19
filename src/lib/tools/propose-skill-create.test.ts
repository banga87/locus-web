// Unit tests for the user-gated skill-create proposal tool.
//
// `propose_skill_create` is side-effect-free: `execute` only validates
// input and returns a structured `{ proposal, isProposal: true }` payload.
// The chat UI picks that up from the tool-result stream and renders an
// Approve / Discard card. The acceptance handler (Task 31) does the
// actual DB write — this tool never touches the DB.
//
// These tests lock in the "no DB writes, ever" invariant by exercising
// execute with both valid and invalid input and asserting that the output
// contract matches what the renderer depends on.
//
// Test-signature note (AI SDK v6): `tool.execute` is typed as
// `(input: INPUT, options: ToolExecutionOptions) => ...`, where
// `ToolExecutionOptions` carries `toolCallId`, `messages`, plus optional
// fields we don't need here. We pass `as never` to side-step the
// precise-typing dance for options that don't affect behaviour.

import { describe, it, expect } from 'vitest';

import { proposeSkillCreateTool } from './propose-skill-create';

describe('propose_skill_create', () => {
  it('happy-path: valid input returns a skill-create proposal', async () => {
    const result = await proposeSkillCreateTool.execute!(
      {
        name: 'customer-onboarding',
        description: 'Guides new customers through the onboarding flow.',
        body: '# Customer Onboarding\n\nStep-by-step guide...',
        resources: [],
        rationale: 'Frequently requested by support agents.',
      },
      { toolCallId: 'tc-1', messages: [] } as never,
    );
    expect(result).toMatchObject({
      proposal: {
        kind: 'skill-create',
        name: 'customer-onboarding',
        description: 'Guides new customers through the onboarding flow.',
        body: '# Customer Onboarding\n\nStep-by-step guide...',
        resources: [],
        rationale: 'Frequently requested by support agents.',
      },
      isProposal: true,
    });
  });

  it('rejects empty name', async () => {
    await expect(
      proposeSkillCreateTool.execute!(
        {
          name: '',
          description: 'Some description.',
          body: 'Some body.',
          resources: [],
          rationale: 'Some rationale.',
        },
        { toolCallId: 'tc-2', messages: [] } as never,
      ),
    ).rejects.toThrow();
  });

  it('rejects empty description', async () => {
    await expect(
      proposeSkillCreateTool.execute!(
        {
          name: 'valid-name',
          description: '',
          body: 'Some body.',
          resources: [],
          rationale: 'Some rationale.',
        },
        { toolCallId: 'tc-3', messages: [] } as never,
      ),
    ).rejects.toThrow();
  });

  it('rejects empty body', async () => {
    await expect(
      proposeSkillCreateTool.execute!(
        {
          name: 'valid-name',
          description: 'Valid description.',
          body: '',
          resources: [],
          rationale: 'Some rationale.',
        },
        { toolCallId: 'tc-4', messages: [] } as never,
      ),
    ).rejects.toThrow();
  });

  it('rejects empty rationale', async () => {
    await expect(
      proposeSkillCreateTool.execute!(
        {
          name: 'valid-name',
          description: 'Valid description.',
          body: 'Valid body.',
          resources: [],
          rationale: '',
        },
        { toolCallId: 'tc-5', messages: [] } as never,
      ),
    ).rejects.toThrow();
  });

  it('resources defaults to [] when omitted', async () => {
    // The schema default([]) means the agent can omit resources entirely.
    // We test that the default applies and the proposal still has the field.
    const result = await proposeSkillCreateTool.execute!(
      {
        name: 'minimal-skill',
        description: 'A minimal skill with no resources.',
        body: 'Body content.',
        rationale: 'Testing default.',
      } as never, // cast: omitting optional-default field
      { toolCallId: 'tc-6', messages: [] } as never,
    );
    expect(result).toMatchObject({
      proposal: {
        kind: 'skill-create',
        resources: [],
      },
      isProposal: true,
    });
  });

  it('resources with both fields populate correctly', async () => {
    const result = await proposeSkillCreateTool.execute!(
      {
        name: 'skill-with-resources',
        description: 'A skill that ships example files.',
        body: 'Body content.',
        resources: [
          { relative_path: 'examples/hello.md', content: '# Hello' },
          { relative_path: 'examples/world.md', content: '# World' },
        ],
        rationale: 'Ships example files alongside the skill.',
      },
      { toolCallId: 'tc-7', messages: [] } as never,
    );
    expect(result).toMatchObject({
      proposal: {
        kind: 'skill-create',
        resources: [
          { relative_path: 'examples/hello.md', content: '# Hello' },
          { relative_path: 'examples/world.md', content: '# World' },
        ],
      },
      isProposal: true,
    });
  });

  it('rejects resource missing relative_path', async () => {
    await expect(
      proposeSkillCreateTool.execute!(
        {
          name: 'valid-name',
          description: 'Valid description.',
          body: 'Valid body.',
          resources: [{ content: 'some content' }] as never,
          rationale: 'Valid rationale.',
        },
        { toolCallId: 'tc-8', messages: [] } as never,
      ),
    ).rejects.toThrow();
  });

  it('rejects name longer than 200 chars', async () => {
    await expect(
      proposeSkillCreateTool.execute!(
        {
          name: 'a'.repeat(201),
          description: 'Valid description.',
          body: 'Valid body.',
          resources: [],
          rationale: 'Valid rationale.',
        },
        { toolCallId: 'tc-9', messages: [] } as never,
      ),
    ).rejects.toThrow();
  });
});

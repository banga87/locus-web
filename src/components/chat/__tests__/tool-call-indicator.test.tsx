// Tool-call indicator state-transition tests. We render under jsdom
// (configured globally in vitest.setup.ts) and assert on the rendered
// output for each indicator state — pending / complete / error.
//
// Also covers the skill-create proposal dispatch: when toolName is
// `propose_skill_create` and result carries a valid SkillCreateProposal,
// the indicator renders <SkillProposalCard> instead of the default pill.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ToolCallIndicator } from '@/components/chat/tool-call-indicator';

describe('ToolCallIndicator', () => {
  it('renders a pending row with the verb-form name', () => {
    render(
      <ToolCallIndicator
        toolName="get_document"
        args={{ path: 'brand/voice' }}
        state="pending"
      />,
    );
    // The trailing ellipsis lives in the same span as the label, so we
    // assert by partial text rather than exact match.
    expect(screen.getByText(/Reading Brand Voice/)).toBeInTheDocument();
  });

  it('renders a "Used:" pill on complete', () => {
    render(
      <ToolCallIndicator
        toolName="search_documents"
        args={{ query: 'voice' }}
        state="complete"
      />,
    );
    expect(screen.getByText(/Used:/)).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('renders a muted "Couldn\'t access" pill on error', () => {
    render(
      <ToolCallIndicator
        toolName="get_document"
        args={{ path: 'missing/path' }}
        state="error"
        errorText="document_not_found"
      />,
    );
    expect(
      screen.getByText(/Couldn't access Missing Path/),
    ).toBeInTheDocument();
  });

  it('humanises external MCP tool names from ext_<hex>_<name>', () => {
    render(
      <ToolCallIndicator
        toolName="ext_001122334455_send_email"
        args={{ to: 'a@b.com' }}
        state="pending"
      />,
    );
    expect(screen.getByText(/Using Send Email/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Skill-create proposal dispatch
  // -------------------------------------------------------------------------

  it('renders <SkillProposalCard> when toolName is propose_skill_create with a valid proposal result', () => {
    const skillResult = {
      isProposal: true,
      proposal: {
        kind: 'skill-create',
        name: 'Code Review',
        description: 'Guidelines for reviewing pull requests.',
        body: '# Code Review\n\nAlways check for test coverage.',
        resources: [],
        rationale: 'Agent detected a recurring review pattern.',
      },
    };

    render(
      <ToolCallIndicator
        toolName="propose_skill_create"
        args={{}}
        state="complete"
        result={skillResult}
      />,
    );

    // SkillProposalCard renders this header.
    expect(
      screen.getByText(/Agent proposes a new skill/),
    ).toBeInTheDocument();
    // Skill name is displayed.
    expect(screen.getByText('Code Review')).toBeInTheDocument();
    // The default "Used:" pill is NOT shown.
    expect(screen.queryByText(/Used:/)).not.toBeInTheDocument();
  });

  it('falls back to the default pill when propose_skill_create result is malformed (missing name)', () => {
    const malformedResult = {
      isProposal: true,
      proposal: {
        kind: 'skill-create',
        // name is missing
        description: 'Oops.',
        body: 'body',
        resources: [],
        rationale: 'reason',
      },
    };

    render(
      <ToolCallIndicator
        toolName="propose_skill_create"
        args={{}}
        state="complete"
        result={malformedResult}
      />,
    );

    // Falls back to the complete pill, not the proposal card.
    expect(screen.getByText(/Used:/)).toBeInTheDocument();
    expect(screen.queryByText(/Agent proposes a new skill/)).not.toBeInTheDocument();
  });
});

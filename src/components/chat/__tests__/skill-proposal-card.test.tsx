// SkillProposalCard component tests.
//
// Exercises the rendering + network paths of the user-gated skill creation
// approval surface. Global `fetch` is mocked per test so we can
// assert the request shape (method, URL, JSON body) without touching
// the accept endpoint.
//
// Coverage:
//   - Renders skill name + description + body preview + rationale.
//   - Renders resource rows with [View] toggle for inline content.
//   - Approve → POST /api/skills/propose/accept with stripped payload
//     (no `kind` field), transitions to success state with link.
//   - Discard → calls `onDiscard`, makes no network call.
//   - HTTP error response (409 slug_taken) → shows inline error.
//   - HTTP error missing .error.message → falls back to status line.
//   - Raw fetch rejection (network-level failure) → shows inline error.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import {
  SkillProposalCard,
  type SkillCreateProposal,
} from '@/components/chat/skill-proposal-card';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_PROPOSAL: SkillCreateProposal = {
  kind: 'skill-create',
  name: 'Code Review',
  description: 'Guidelines for reviewing pull requests.',
  body: '# Code Review\n\nAlways check for test coverage.',
  resources: [],
  rationale: 'Agent detected a recurring review pattern.',
};

const PROPOSAL_WITH_RESOURCES: SkillCreateProposal = {
  ...BASE_PROPOSAL,
  resources: [
    { relative_path: 'examples/checklist.md', content: '- [ ] Check tests' },
    { relative_path: 'templates/pr-template.md', content: '## Summary\n\n...' },
  ],
};

/** Build a resolved `fetch` mock that returns the given body + ok status. */
function mockJsonResponse(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 409 ? 'Conflict' : status === 500 ? 'Internal Server Error' : 'OK',
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SkillProposalCard', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  it('renders the skill name, description, body preview, and rationale', () => {
    render(<SkillProposalCard proposal={BASE_PROPOSAL} />);
    expect(
      screen.getByText(/Agent proposes a new skill/),
    ).toBeInTheDocument();
    expect(screen.getByText('Code Review')).toBeInTheDocument();
    expect(
      screen.getByText('Guidelines for reviewing pull requests.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('skill-body-preview').textContent).toContain(
      'Always check for test coverage.',
    );
    expect(
      screen.getByText(/Agent detected a recurring review pattern/),
    ).toBeInTheDocument();
  });

  it('renders resource file rows with a [View] button each', () => {
    render(<SkillProposalCard proposal={PROPOSAL_WITH_RESOURCES} />);
    expect(screen.getByText('examples/checklist.md')).toBeInTheDocument();
    expect(screen.getByText('templates/pr-template.md')).toBeInTheDocument();
    // Both collapsed by default — two "View" buttons visible.
    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    expect(viewButtons).toHaveLength(2);
  });

  it('expands a resource row when [View] is clicked and collapses on [Hide]', () => {
    render(<SkillProposalCard proposal={PROPOSAL_WITH_RESOURCES} />);
    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    // Click the first resource's View button.
    fireEvent.click(viewButtons[0]);
    // Content is now visible.
    expect(screen.getByText('- [ ] Check tests')).toBeInTheDocument();
    // The button now says "Hide".
    expect(screen.getByRole('button', { name: /hide/i })).toBeInTheDocument();
    // Click Hide to collapse.
    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    expect(
      screen.queryByText('- [ ] Check tests'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing in the resources section when resources is empty', () => {
    render(<SkillProposalCard proposal={BASE_PROPOSAL} />);
    expect(screen.queryByText(/Resources/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Approve — happy path
  // -------------------------------------------------------------------------

  it('clicking Approve POSTs to accept endpoint, transitions to success with skill link', async () => {
    const onApprove = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse(
        { success: true, data: { skill_id: 'skill-uuid-abc' } },
        { status: 201 },
      ),
    );

    render(
      <SkillProposalCard proposal={BASE_PROPOSAL} onApprove={onApprove} />,
    );
    fireEvent.click(screen.getByTestId('skill-proposal-approve'));

    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));

    // Assert success state with a link.
    expect(screen.getByTestId('skill-proposal-success')).toBeInTheDocument();
    const link = screen.getByTestId('skill-proposal-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/skills/skill-uuid-abc');

    // Assert request shape — exactly one fetch call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/skills/propose/accept');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    // `kind` must NOT be in the request body.
    expect(body).not.toHaveProperty('kind');
    // All other fields must be present.
    expect(body).toMatchObject({
      name: 'Code Review',
      description: 'Guidelines for reviewing pull requests.',
      body: '# Code Review\n\nAlways check for test coverage.',
      resources: [],
      rationale: 'Agent detected a recurring review pattern.',
    });
  });

  it('includes resources in the POST body when the proposal has them', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse(
        { success: true, data: { skill_id: 'skill-uuid-xyz' } },
        { status: 201 },
      ),
    );

    render(<SkillProposalCard proposal={PROPOSAL_WITH_RESOURCES} />);
    fireEvent.click(screen.getByTestId('skill-proposal-approve'));

    await waitFor(() =>
      expect(screen.getByTestId('skill-proposal-success')).toBeInTheDocument(),
    );

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.resources).toHaveLength(2);
    expect(body.resources[0]).toMatchObject({
      relative_path: 'examples/checklist.md',
      content: '- [ ] Check tests',
    });
  });

  // -------------------------------------------------------------------------
  // Approve — error states
  // -------------------------------------------------------------------------

  it('surfaces slug_taken 409 error inline without crashing', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse(
        {
          success: false,
          error: {
            code: 'slug_taken',
            message: "A skill named 'Code Review' already exists in this workspace.",
          },
        },
        { status: 409 },
      ),
    );

    render(<SkillProposalCard proposal={BASE_PROPOSAL} />);
    fireEvent.click(screen.getByTestId('skill-proposal-approve'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /already exists in this workspace/,
    );
    // Buttons are re-enabled after error (not in settled state).
    expect(screen.getByTestId('skill-proposal-approve')).not.toBeDisabled();
  });

  it('falls back to status line when error response has no .error.message', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({}, { status: 500 }),
    );

    render(<SkillProposalCard proposal={BASE_PROPOSAL} />);
    fireEvent.click(screen.getByTestId('skill-proposal-approve'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/500/);
  });

  it('surfaces inline error when the fetch rejects with a network-level failure', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    render(<SkillProposalCard proposal={BASE_PROPOSAL} />);
    fireEvent.click(screen.getByTestId('skill-proposal-approve'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/network down/);
  });

  // -------------------------------------------------------------------------
  // Discard
  // -------------------------------------------------------------------------

  it('Discard calls onDiscard without hitting the network', () => {
    const onDiscard = vi.fn();
    render(
      <SkillProposalCard proposal={BASE_PROPOSAL} onDiscard={onDiscard} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Discard removes the card from the document (self-dismiss)', () => {
    const { queryByTestId } = render(
      <SkillProposalCard proposal={BASE_PROPOSAL} />,
    );
    expect(queryByTestId('skill-proposal-card')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(queryByTestId('skill-proposal-card')).toBeNull();
    // No network call on discard.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Duplicate relative_path guard (I1)
  // -------------------------------------------------------------------------

  it('two resources with identical relative_path both render and expand independently', () => {
    const dupProposal: SkillCreateProposal = {
      ...BASE_PROPOSAL,
      resources: [
        { relative_path: 'dup.md', content: 'first content' },
        { relative_path: 'dup.md', content: 'second content' },
      ],
    };
    render(<SkillProposalCard proposal={dupProposal} />);

    // Both rows rendered — two "View" buttons.
    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    expect(viewButtons).toHaveLength(2);

    // Expand first row.
    fireEvent.click(viewButtons[0]);
    expect(screen.getByTestId('resource-content-0')).toBeInTheDocument();
    expect(screen.getByTestId('resource-content-0').textContent).toBe('first content');
    // Second row still collapsed.
    expect(screen.queryByTestId('resource-content-1')).not.toBeInTheDocument();

    // Expand second row.
    const hideAndViewButtons = screen.getAllByRole('button', { name: /view|hide/i });
    const secondViewButton = hideAndViewButtons.find(
      (btn) => btn.textContent === 'View',
    );
    fireEvent.click(secondViewButton!);
    expect(screen.getByTestId('resource-content-1')).toBeInTheDocument();
    expect(screen.getByTestId('resource-content-1').textContent).toBe('second content');

    // Both pre elements have distinct ids.
    expect(screen.getByTestId('resource-content-0').id).toBe('resource-content-0');
    expect(screen.getByTestId('resource-content-1').id).toBe('resource-content-1');
  });
});

// ProposalCard component tests.
//
// Exercises the rendering + network paths of the user-gated write
// approval surface. Global `fetch` is mocked per test so we can
// assert the request shape (method, URL, JSON body) without touching
// the Brain CRUD endpoints.
//
// Coverage:
//   - Create proposal renders title + category preview.
//   - Update proposal renders target_doc_id + rationale.
//   - Approve on create → GET /api/brain/categories, then POST
//     /api/brain/documents with the resolved categoryId.
//   - Approve on create forwards `attachmentId` in the POST body
//     (Task 8 seam).
//   - Approve on update → PATCH /api/brain/documents/[id] with
//     body + frontmatter_patch forwarded as `content` + `frontmatterPatch`,
//     and `attachmentId` forwarded when supplied (same Task 8 seam).
//   - Discard → calls `onDiscard`, makes no network call.
//   - HTTP error response → shows inline error without crashing.
//   - Raw fetch rejection (network-level failure) → shows inline error
//     without crashing (exercises the `catch` in `handleApprove`).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import {
  ProposalCard,
  type CreateProposal,
  type UpdateProposal,
} from '@/components/chat/proposal-card';

const CREATE_PROPOSAL: CreateProposal = {
  kind: 'create',
  category: 'sources',
  type: 'knowledge',
  title: 'Q3 Brand Brief',
  frontmatter: { tags: ['source'] },
  body_markdown: '# Brief\n\nContent.',
  rationale: 'Filed from attachment.',
};

const UPDATE_PROPOSAL: UpdateProposal = {
  kind: 'update',
  target_doc_id: '11111111-2222-4333-8444-555555555555',
  body_patch: 'Corrected figure.',
  frontmatter_patch: { status: 'active' },
  rationale: 'User corrected a mis-quoted number.',
};

/** Build a resolved `fetch` mock that returns the given body + ok status. */
function mockJsonResponse(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

describe('ProposalCard', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Cast through `unknown` because jsdom's default fetch is typed
    // narrowly. We install a spy per-test so each case can queue its
    // own responses.
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  it('renders a create proposal with title + category preview', () => {
    render(<ProposalCard proposal={CREATE_PROPOSAL} />);
    expect(
      screen.getByText(/Agent proposes a new document/),
    ).toBeInTheDocument();
    expect(screen.getByText('Q3 Brand Brief')).toBeInTheDocument();
    expect(screen.getByText('sources')).toBeInTheDocument();
    expect(screen.getByText('knowledge')).toBeInTheDocument();
    expect(screen.getByText(/Filed from attachment/)).toBeInTheDocument();
  });

  it('renders an update proposal with target doc id + rationale', () => {
    render(<ProposalCard proposal={UPDATE_PROPOSAL} />);
    expect(screen.getByText(/Agent proposes an update/)).toBeInTheDocument();
    expect(
      screen.getByText('11111111-2222-4333-8444-555555555555'),
    ).toBeInTheDocument();
    expect(screen.getByText('Corrected figure.')).toBeInTheDocument();
    expect(
      screen.getByText(/User corrected a mis-quoted number/),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Approve — create
  // -------------------------------------------------------------------------

  it('clicking Approve on a create proposal resolves the category, POSTs the doc, and fires onApprove', async () => {
    const onApprove = vi.fn();
    // First fetch: GET /api/brain/categories → list with a match.
    // Second fetch: POST /api/brain/documents → 2xx.
    fetchSpy
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: [
            { id: 'cat-sources-id', slug: 'sources' },
            { id: 'cat-other-id', slug: 'other' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ id: 'doc-new-id' }, { status: 201 }),
      );

    render(
      <ProposalCard
        proposal={CREATE_PROPOSAL}
        attachmentId="att-1"
        onApprove={onApprove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));

    // First call — categories lookup.
    const firstCall = fetchSpy.mock.calls[0];
    expect(firstCall[0]).toBe('/api/brain/categories');

    // Second call — document POST. Assert URL, method, and body shape.
    const secondCall = fetchSpy.mock.calls[1];
    expect(secondCall[0]).toBe('/api/brain/documents');
    const init = secondCall[1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      title: 'Q3 Brand Brief',
      slug: 'q3-brand-brief',
      content: '# Brief\n\nContent.',
      categoryId: 'cat-sources-id',
      attachmentId: 'att-1',
    });
  });

  it('shows an error when the proposed category does not exist in the brain', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({
        // No `sources` slug in the list — the card must surface this
        // instead of silently POSTing with a bogus categoryId.
        data: [{ id: 'cat-other-id', slug: 'other' }],
      }),
    );

    render(<ProposalCard proposal={CREATE_PROPOSAL} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /Category "sources" does not exist/,
    );
    // Only one fetch — the POST never fires.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Approve — update
  // -------------------------------------------------------------------------

  it('clicking Approve on an update proposal PATCHes the target doc and forwards attachmentId', async () => {
    const onApprove = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ id: UPDATE_PROPOSAL.target_doc_id }),
    );

    render(
      <ProposalCard
        proposal={UPDATE_PROPOSAL}
        attachmentId="att-patch-1"
        onApprove={onApprove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/brain/documents/${UPDATE_PROPOSAL.target_doc_id}`,
    );
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string);
    // Lock in the Task 8 seam on the PATCH path as well as POST — the
    // field is passed through today, consumed server-side once Task 8
    // ships session_attachments commit wiring.
    expect(body).toMatchObject({
      content: 'Corrected figure.',
      frontmatterPatch: { status: 'active' },
      attachmentId: 'att-patch-1',
    });
  });

  it('surfaces inline error when the PATCH endpoint returns non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse(
        { error: { code: 'not_found', message: 'Document not found.' } },
        { status: 404 },
      ),
    );

    render(<ProposalCard proposal={UPDATE_PROPOSAL} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /Document not found/,
    );
  });

  it('surfaces inline error when the fetch rejects with a network-level failure', async () => {
    // Exercises the `catch` block in `handleApprove` — distinct from
    // the non-2xx HTTP path above. A raw rejection (DNS failure,
    // offline, CORS preflight reject) must not crash the card: the
    // user sees the underlying message inline so they know to retry.
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    render(<ProposalCard proposal={UPDATE_PROPOSAL} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

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
      <ProposalCard proposal={CREATE_PROPOSAL} onDiscard={onDiscard} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

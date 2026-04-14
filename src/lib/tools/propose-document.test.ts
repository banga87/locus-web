// Unit tests for the user-gated write proposals.
//
// Both `propose_document_create` and `propose_document_update` are
// deliberately side-effect-free: `execute` only validates input (via
// the AI SDK's built-in Zod wrapper on `inputSchema`) and returns a
// structured `{ proposal, isProposal: true }` payload. The chat UI
// picks that up from the tool-result stream and renders an Approve /
// Discard card (see `src/components/chat/proposal-card.tsx`).
//
// These tests lock in the "no DB writes, ever" invariant by
// exercising the execute function with both valid and invalid input
// and asserting that the output contract matches what the renderer
// depends on. Any future "optimisation" that short-circuits to a
// direct DB insert will break the happy-path assertion here.
//
// Test-signature note (AI SDK v6): `tool.execute` is typed as
// `(input: INPUT, options: ToolExecutionOptions) => ...`, where
// `ToolExecutionOptions` carries `toolCallId`, `messages`, plus a
// bunch of optional fields the caller rarely supplies in unit
// tests. We pass `as never` to side-step the precise-typing dance
// for options fields that don't affect behaviour here.

import { describe, it, expect } from 'vitest';

import {
  proposeDocumentCreateTool,
  proposeDocumentUpdateTool,
} from './propose-document';

describe('propose_document_create', () => {
  it('validates required fields and returns a create proposal', async () => {
    // `tool()` on AI SDK v6 wraps `execute` so that input is
    // validated before the body runs. The happy-path call passes
    // through cleanly and the output matches the renderer's
    // discriminator: `result.isProposal === true` plus a `proposal`
    // object with `kind: 'create'`.
    const result = await proposeDocumentCreateTool.execute!(
      {
        category: 'sources',
        type: 'knowledge',
        title: 'Q3 Brand Brief (source)',
        frontmatter: { tags: ['source', 'brand'] },
        body_markdown: 'Brief content.',
        rationale: 'Filed from attachment.',
      },
      { toolCallId: 'tc-1', messages: [] } as never,
    );
    expect(result).toMatchObject({
      proposal: {
        kind: 'create',
        title: 'Q3 Brand Brief (source)',
        category: 'sources',
        type: 'knowledge',
        frontmatter: { tags: ['source', 'brand'] },
        body_markdown: 'Brief content.',
        rationale: 'Filed from attachment.',
      },
      isProposal: true,
    });
  });

  it('rejects missing title', async () => {
    // Empty string fails the `title: z.string().min(1)` guard. The
    // AI SDK wraps `execute` with schema validation; invalid input
    // propagates as a thrown validation error.
    await expect(
      proposeDocumentCreateTool.execute!(
        {
          category: 'sources',
          type: 'knowledge',
          title: '',
          frontmatter: {},
          body_markdown: 'x',
          rationale: 'x',
        },
        { toolCallId: 'tc-2', messages: [] } as never,
      ),
    ).rejects.toThrow();
  });
});

describe('propose_document_update', () => {
  it('validates required fields and returns an update proposal', async () => {
    // `target_doc_id` must be a valid UUID. Both frontmatter_patch
    // and body_patch are optional — an update that only rewords a
    // title via frontmatter is valid on its own. The test passes
    // all three so we exercise the full shape.
    const result = await proposeDocumentUpdateTool.execute!(
      {
        target_doc_id: '11111111-2222-4333-8444-555555555555',
        frontmatter_patch: { status: 'active' },
        body_patch: 'Updated body.',
        rationale: 'User corrected figure.',
      },
      { toolCallId: 'tc-3', messages: [] } as never,
    );
    expect(result).toMatchObject({
      proposal: {
        kind: 'update',
        target_doc_id: '11111111-2222-4333-8444-555555555555',
        frontmatter_patch: { status: 'active' },
        body_patch: 'Updated body.',
        rationale: 'User corrected figure.',
      },
      isProposal: true,
    });
  });

  it('rejects missing target_doc_id', async () => {
    // Empty string is not a valid UUID; the schema rejects before
    // execute's body runs. Kept separate from the "missing rationale"
    // case so a regression in EITHER check surfaces clearly.
    await expect(
      proposeDocumentUpdateTool.execute!(
        {
          target_doc_id: '',
          body_patch: 'x',
          rationale: 'x',
        },
        { toolCallId: 'tc-4', messages: [] } as never,
      ),
    ).rejects.toThrow();
  });

  it('rejects empty rationale', async () => {
    // Rationale is non-empty so the audit trail always carries
    // a human-readable reason. The UI displays it verbatim on
    // the approval card.
    await expect(
      proposeDocumentUpdateTool.execute!(
        {
          target_doc_id: '11111111-2222-4333-8444-555555555556',
          body_patch: 'x',
          rationale: '',
        },
        { toolCallId: 'tc-5', messages: [] } as never,
      ),
    ).rejects.toThrow();
  });
});

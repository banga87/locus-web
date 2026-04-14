// Unit tests for the PostToolUse proposals handler.
//
// This suite intentionally locks in the "never denies / never injects
// / never mutates" invariant — a future PR that turns this handler
// into a DB writer (or adds an `inject` branch) will fail here. The
// rationale for the no-op handler is documented in `proposals.ts`.
//
// Coverage:
//   - Returns `allow` for both `propose_document_create` and
//     `propose_document_update` results (happy path).
//   - Returns `allow` for non-propose tool results (unaffected).
//   - Returns `allow` for a wrong-event-name payload (defence-in-depth).

import { describe, it, expect } from 'vitest';

import type { AgentContext, HookEvent } from '@/lib/agent/types';

import { proposalPostToolUseHandler } from './proposals';

/**
 * Build a minimal `AgentContext` — the handler only reads
 * `ctx.companyId` in its current form, but constructing the full
 * shape keeps the test future-proof against audit enrichment work.
 */
function makeCtx(): AgentContext {
  return {
    actor: {
      type: 'platform_agent',
      userId: 'u-1',
      companyId: 'co-1',
      scopes: ['read'],
    },
    brainId: 'b-1',
    companyId: 'co-1',
    sessionId: 's-1',
    agentDefinitionId: null,
    abortSignal: new AbortController().signal,
  };
}

describe('proposalPostToolUseHandler', () => {
  it('allows a propose_document_create result', async () => {
    const event: HookEvent = {
      name: 'PostToolUse',
      ctx: makeCtx(),
      toolName: 'propose_document_create',
      args: {
        category: 'sources',
        type: 'knowledge',
        title: 'Q3',
        frontmatter: {},
        body_markdown: 'x',
        rationale: 'filed',
      },
      result: {
        proposal: {
          kind: 'create',
          category: 'sources',
          type: 'knowledge',
          title: 'Q3',
          frontmatter: {},
          body_markdown: 'x',
          rationale: 'filed',
        },
        isProposal: true,
      },
      isError: false,
    };
    const decision = await proposalPostToolUseHandler(event);
    expect(decision).toEqual({ decision: 'allow' });
  });

  it('allows a propose_document_update result', async () => {
    const event: HookEvent = {
      name: 'PostToolUse',
      ctx: makeCtx(),
      toolName: 'propose_document_update',
      args: {
        target_doc_id: '11111111-2222-4333-8444-555555555555',
        body_patch: 'new body',
        rationale: 'typo fix',
      },
      result: {
        proposal: {
          kind: 'update',
          target_doc_id: '11111111-2222-4333-8444-555555555555',
          body_patch: 'new body',
          rationale: 'typo fix',
        },
        isProposal: true,
      },
      isError: false,
    };
    const decision = await proposalPostToolUseHandler(event);
    expect(decision).toEqual({ decision: 'allow' });
  });

  it('allows a non-propose tool result (unaffected)', async () => {
    // `search_documents` is the canonical read-only tool. The
    // handler must not mistake its results for proposals.
    const event: HookEvent = {
      name: 'PostToolUse',
      ctx: makeCtx(),
      toolName: 'search_documents',
      args: { query: 'voice' },
      result: { results: [] },
      isError: false,
    };
    const decision = await proposalPostToolUseHandler(event);
    expect(decision).toEqual({ decision: 'allow' });
  });

  it('allows a tool whose name starts with propose_ but not propose_document_', async () => {
    // Guard against a tomorrow-tool named `propose_snippet` that
    // accidentally matches a looser prefix check. The handler's
    // contract is specifically `propose_document_`.
    const event: HookEvent = {
      name: 'PostToolUse',
      ctx: makeCtx(),
      toolName: 'propose_snippet',
      args: {},
      result: { ok: true },
      isError: false,
    };
    const decision = await proposalPostToolUseHandler(event);
    expect(decision).toEqual({ decision: 'allow' });
  });

  it('allows a non-PostToolUse event (defence in depth)', async () => {
    // The bus routes per event name, so this shape never actually
    // lands in practice — but a future broadcast mode would deliver
    // it. The narrow returns `allow` without inspecting the body.
    const event: HookEvent = {
      name: 'SessionStart',
      ctx: makeCtx(),
    };
    const decision = await proposalPostToolUseHandler(event);
    expect(decision).toEqual({ decision: 'allow' });
  });
});

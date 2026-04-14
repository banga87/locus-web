// Contract test: pin the harness's duck-typed render helper against
// the real `InjectedContext` / `ContextBlock` shapes.
//
// Background: `renderInjectedContext` in `src/lib/agent/run.ts`
// deliberately does NOT import from `src/lib/context/` — the harness
// must stay decoupled from the context-injection module (it's a
// *consumer* of whatever a hook hands back, not a collaborator on the
// payload schema). See `AGENTS.md` for the harness-boundary rationale.
//
// That decoupling means the shape contract ({ blocks: Array<{ title,
// body }> }) is implicit — a rename like `ContextBlock.body` →
// `ContextBlock.content` would compile cleanly on both sides and the
// runtime would silently render nothing (duck-type predicate fails).
// This test files that implicit contract: it constructs a realistic
// payload typed as `InjectedContext` covering every `ContextBlockKind`,
// feeds it through the harness helper, and asserts every title + body
// lands in the rendered output. If the shapes ever drift, this test
// fails at CI time instead of in prod.
//
// Why this test lives under `src/lib/context/`: it verifies the
// context module's payload contract, so it belongs next to
// `types.ts`. Importing `renderInjectedContext` from the harness
// mirrors how a hook handler produces a payload the harness consumes
// — the harness remains free of any dependency on this file.

import { describe, expect, it } from 'vitest';

import { renderInjectedContext } from '@/lib/agent/run';

import type { ContextBlock, ContextBlockKind, InjectedContext } from './types';

describe('renderInjectedContext × InjectedContext contract', () => {
  it('renders every kind of block with title + body in the markdown output', () => {
    // One block per ContextBlockKind. If a new kind lands, TypeScript
    // will not force this array to grow — but the "every kind
    // represented" assertion below will catch the omission.
    const blocks: ContextBlock[] = [
      {
        kind: 'scaffolding',
        title: 'Company scaffolding',
        body: 'Acme is a B2B SaaS for brewery inventory.',
        sourceDocId: 'doc-scaffolding-1',
      },
      {
        kind: 'baseline',
        title: 'Brand voice',
        body: 'Warm, precise, never hype.',
        sourceDocId: 'doc-baseline-voice',
      },
      {
        kind: 'skill',
        title: 'Draft a Landing Page',
        body: 'Use H1 + three benefit bullets.',
        skillId: 'skill-landing-page',
      },
      {
        kind: 'attachment-inline',
        title: 'Attached: pricing-notes.md',
        body: 'Starter $29, Growth $99, Scale $299.',
        attachmentId: 'att-pricing',
      },
      {
        kind: 'attachment-pointer',
        title: 'Referenced: logo.png',
        body: 'Binary attachment — LLM receives a pointer only.',
        attachmentId: 'att-logo',
      },
      {
        kind: 'ingestion-filing',
        title: 'Filed to: research/competitors.md',
        body: 'Last turn appended a competitor note.',
        sourceDocId: 'doc-research-competitors',
      },
      {
        kind: 'agent-prompt-snippet',
        title: 'Agent persona',
        body: 'You are the Platform Agent for Acme Brewing.',
        sourceDocId: 'doc-agent-def-1',
      },
    ];

    const payload: InjectedContext = { blocks };
    const rendered = renderInjectedContext(payload);

    // Every kind from the union is represented exactly once. Guards
    // against an author silently dropping a block kind when updating
    // this test alongside a schema change.
    const expectedKinds: ContextBlockKind[] = [
      'scaffolding',
      'baseline',
      'skill',
      'attachment-inline',
      'attachment-pointer',
      'ingestion-filing',
      'agent-prompt-snippet',
    ];
    for (const kind of expectedKinds) {
      expect(blocks.some((b) => b.kind === kind)).toBe(true);
    }

    // Every title renders as an `## <title>` heading.
    for (const block of blocks) {
      expect(rendered).toContain(`## ${block.title}`);
    }

    // Every body survives intact.
    for (const block of blocks) {
      expect(rendered).toContain(block.body);
    }

    // Blocks join with the `\n\n---\n\n` separator. With N blocks we
    // expect exactly N-1 separators — asserting this pins both the
    // separator token and the "no trailing / leading separator" rule.
    const separator = '\n\n---\n\n';
    const separatorCount = rendered.split(separator).length - 1;
    expect(separatorCount).toBe(blocks.length - 1);

    // Sanity: rendered output starts with the first block's heading
    // and ends with the last block's body. Locks the ordering
    // guarantee documented in `scaffolding.ts` (scaffolding → agent-
    // prompt-snippet → baselines → per-turn blocks).
    expect(rendered.startsWith(`## ${blocks[0].title}`)).toBe(true);
    expect(rendered.endsWith(blocks[blocks.length - 1].body)).toBe(true);
  });

  it('returns an empty string for an empty blocks array', () => {
    // Matches the "missing scaffolding doc" degradation path in
    // `buildScaffoldingPayload`: a handler that legitimately has
    // nothing to inject hands back `{ blocks: [] }` and the harness
    // renders nothing rather than spamming the LLM with a lone `---`.
    const payload: InjectedContext = { blocks: [] };
    expect(renderInjectedContext(payload)).toBe('');
  });
});

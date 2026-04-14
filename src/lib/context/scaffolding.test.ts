// Unit tests for `buildScaffoldingPayload`.
//
// The function is pure — a `ScaffoldingRepo` is injected so these tests
// never touch the DB. `repos.ts` owns the Drizzle-backed implementation
// and is covered by a separate integration test that exercises the
// query layer against live Supabase.
//
// Coverage (Task 5 Step 1 in the Phase 1.5 plan):
//   1. Scaffolding + agent-prompt-snippet + baseline blocks materialise
//      in the expected order for the happy path.
//   2. `agentDefinitionId = null` skips the agent-specific blocks —
//      only the scaffolding block lands.
//   3. A missing `agent-scaffolding` doc returns `{ blocks: [] }` and
//      emits a `console.warn` so operators can spot a mis-seeded
//      company.
//   4. Baseline docs flagged `archived` get a visible "archived"
//      annotation appended to their body (the agent needs to know the
//      content may be stale).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScaffoldingRepo } from './scaffolding';
import { buildScaffoldingPayload } from './scaffolding';

function makeRepo(overrides: Partial<ScaffoldingRepo> = {}): ScaffoldingRepo {
  return {
    getAgentScaffolding: vi.fn(async () => ({
      id: 's1',
      title: 'How Acme Works',
      body: 'Acme is a marketing agency.',
      version: 3,
    })),
    getAgentDefinition: vi.fn(async (id: string) => ({
      id,
      title: 'Marketing Copywriter',
      systemPromptSnippet: 'You are a copywriter.',
      baselineDocIds: ['a7f3c2e4-1', 'a7f3c2e4-2'],
    })),
    getDocsByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({
        id,
        title: `Doc ${id}`,
        body: `Body of ${id}`,
        status: 'active' as const,
      })),
    ),
    ...overrides,
  };
}

describe('buildScaffoldingPayload', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns scaffolding + snippet + baseline doc blocks in order', async () => {
    const repo = makeRepo();
    const payload = await buildScaffoldingPayload(
      { companyId: 'co-1', agentDefinitionId: 'ad-1' },
      repo,
    );
    expect(payload.blocks.map((b) => b.kind)).toEqual([
      'scaffolding',
      'agent-prompt-snippet',
      'baseline',
      'baseline',
    ]);
    expect(payload.blocks[0].body).toContain('Acme');
    expect(payload.blocks[0].sourceDocId).toBe('s1');
    expect(payload.blocks[1].body).toContain('copywriter');
    expect(payload.blocks[2].sourceDocId).toBe('a7f3c2e4-1');
    expect(payload.blocks[3].sourceDocId).toBe('a7f3c2e4-2');
  });

  it('omits agent-definition blocks when agentDefinitionId is null', async () => {
    const repo = makeRepo();
    const payload = await buildScaffoldingPayload(
      { companyId: 'co-1', agentDefinitionId: null },
      repo,
    );
    expect(payload.blocks.map((b) => b.kind)).toEqual(['scaffolding']);
    // The agent-definition repo method should not have been consulted
    // when there's no agent id to look up.
    expect(repo.getAgentDefinition).not.toHaveBeenCalled();
  });

  it('logs warning and returns empty blocks when scaffolding doc is missing', async () => {
    const repo = makeRepo({
      getAgentScaffolding: vi.fn(async () => null),
    });
    const payload = await buildScaffoldingPayload(
      { companyId: 'co-1', agentDefinitionId: null },
      repo,
    );
    expect(payload.blocks).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // The warning should mention the company so operators can trace it.
    const [msg] = warnSpy.mock.calls[0];
    expect(String(msg)).toContain('co-1');
  });

  it('annotates archived baseline docs with a note', async () => {
    const repo = makeRepo({
      getDocsByIds: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({
          id,
          title: `Doc ${id}`,
          body: 'body',
          status: 'archived' as const,
        })),
      ),
    });
    const payload = await buildScaffoldingPayload(
      { companyId: 'co-1', agentDefinitionId: 'ad-1' },
      repo,
    );
    const baseline = payload.blocks.find((b) => b.kind === 'baseline');
    expect(baseline).toBeDefined();
    expect(baseline!.body).toMatch(/archived/i);
  });

  it('still returns the scaffolding block when the agent-definition cannot be loaded', async () => {
    const repo = makeRepo({
      getAgentDefinition: vi.fn(async () => null),
    });
    const payload = await buildScaffoldingPayload(
      { companyId: 'co-1', agentDefinitionId: 'missing-ad' },
      repo,
    );
    expect(payload.blocks.map((b) => b.kind)).toEqual(['scaffolding']);
    expect(repo.getDocsByIds).not.toHaveBeenCalled();
  });

  it('skips the agent-prompt-snippet block when the snippet is empty', async () => {
    const repo = makeRepo({
      getAgentDefinition: vi.fn(async (id: string) => ({
        id,
        title: 'Silent Agent',
        systemPromptSnippet: '',
        baselineDocIds: [],
      })),
    });
    const payload = await buildScaffoldingPayload(
      { companyId: 'co-1', agentDefinitionId: 'ad-2' },
      repo,
    );
    expect(payload.blocks.map((b) => b.kind)).toEqual(['scaffolding']);
  });

  it('short-circuits the docs lookup when baseline_docs is empty', async () => {
    const repo = makeRepo({
      getAgentDefinition: vi.fn(async (id: string) => ({
        id,
        title: 'Snippet-only agent',
        systemPromptSnippet: 'Hello.',
        baselineDocIds: [],
      })),
    });
    const payload = await buildScaffoldingPayload(
      { companyId: 'co-1', agentDefinitionId: 'ad-3' },
      repo,
    );
    expect(payload.blocks.map((b) => b.kind)).toEqual([
      'scaffolding',
      'agent-prompt-snippet',
    ]);
    expect(repo.getDocsByIds).not.toHaveBeenCalled();
  });
});

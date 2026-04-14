// Unit tests for `buildUserPromptPayload`.
//
// The function is pure — a `UserPromptRepo` is injected so these tests
// never touch the DB. `repos.ts` owns the Drizzle-backed implementation
// and is covered by a separate integration test that exercises the
// query layer against live Supabase.
//
// Coverage (Task 6 Step 1 in the Phase 1.5 plan):
//   Skill matching:
//     - matched skill lands as `kind: 'skill'` when the agent's
//       candidate pool includes it.
//     - a skill outside the candidate pool never lands even when its
//       triggers match.
//     - skill budget: N matches whose concatenated body exceeds
//       SKILL_BUDGET_BYTES → the excess (lowest-priority) is dropped.
//   Attachments:
//     - small extracted text (<8KB) → `kind: 'attachment-inline'`
//       block AND (when the filing skill is seeded) a companion
//       `kind: 'ingestion-filing'` block.
//     - large extracted text (≥8KB) → `kind: 'attachment-pointer'`
//       block, never inline, carrying the user-facing question text.
//   Graceful degradation:
//     - no manifest → no skill blocks, no throw.
//     - no agentSkillIds → no skill blocks, no manifest fetch.
//     - no attachments → no ingestion-filing block (even when the
//       filing skill exists — the co-injection is attachment-gated).

import { describe, it, expect, vi } from 'vitest';

import {
  ATTACHMENT_INLINE_THRESHOLD_BYTES,
  SKILL_BUDGET_BYTES,
} from './budgets';
import type { UserPromptRepo } from './user-prompt';
import { buildUserPromptPayload } from './user-prompt';

const sampleManifest = {
  version: 1 as const,
  builtAt: '2026-04-14T00:00:00Z',
  diagnostics: [],
  skills: [
    {
      id: 'c9f5e4a6-1',
      slug: 'draft-landing-page',
      title: 'Draft a Landing Page',
      description: '',
      priority: 5,
      triggers: {
        phrases: ['landing page'],
        allOf: [],
        anyOf: [],
        minScore: 1,
      },
      bodyDocId: 'c9f5e4a6-1',
      bodyBytes: 400,
    },
  ],
};

function makeRepo(overrides: Partial<UserPromptRepo> = {}): UserPromptRepo {
  return {
    getManifest: vi.fn(async () => sampleManifest),
    getSkillBodies: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, body: `body of ${id}` })),
    ),
    getExtractedAttachments: vi.fn(async () => []),
    getIngestionFilingSkill: vi.fn(async () => null),
    ...overrides,
  };
}

describe('buildUserPromptPayload (skill matching)', () => {
  it('includes matched skills for the agent candidate pool', async () => {
    const repo = makeRepo();
    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: ['c9f5e4a6-1'],
        userMessage: 'please draft a landing page for our product',
      },
      repo,
    );
    const skillBlocks = payload.blocks.filter((b) => b.kind === 'skill');
    expect(skillBlocks).toHaveLength(1);
    expect(skillBlocks[0].skillId).toBe('c9f5e4a6-1');
    expect(skillBlocks[0].title).toBe('Draft a Landing Page');
    expect(skillBlocks[0].body).toBe('body of c9f5e4a6-1');
    expect(skillBlocks[0].sourceDocId).toBe('c9f5e4a6-1');
  });

  it('excludes skills outside the agent candidate pool', async () => {
    const repo = makeRepo();
    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: ['different-id'],
        userMessage: 'draft a landing page',
      },
      repo,
    );
    expect(payload.blocks.filter((b) => b.kind === 'skill')).toHaveLength(0);
  });

  it('skips skill matching when the candidate pool is empty', async () => {
    const repo = makeRepo();
    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: [],
        userMessage: 'draft a landing page',
      },
      repo,
    );
    expect(payload.blocks.filter((b) => b.kind === 'skill')).toHaveLength(0);
    // Empty candidate pool means the agent has no skills bound — don't
    // waste a DB round-trip fetching the manifest.
    expect(repo.getManifest).not.toHaveBeenCalled();
  });

  it('skips skill matching when no manifest exists yet', async () => {
    const repo = makeRepo({
      getManifest: vi.fn(async () => null),
    });
    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: ['c9f5e4a6-1'],
        userMessage: 'draft a landing page',
      },
      repo,
    );
    expect(payload.blocks.filter((b) => b.kind === 'skill')).toHaveLength(0);
    // Manifest miss → skip the body fetch entirely.
    expect(repo.getSkillBodies).not.toHaveBeenCalled();
  });

  it('respects skill budget — drops lowest-priority skills over cap', async () => {
    // Three skills that all match the prompt. Each body is 3KB — two
    // fit (6KB), three do not (9KB > 8KB SKILL_BUDGET_BYTES). Priority
    // ordering: high > mid > low. After the budget check we expect
    // only the high- and mid-priority skills to land.
    const bigBody = 'x'.repeat(3 * 1024);
    const threeSkillManifest = {
      version: 1 as const,
      builtAt: '2026-04-14T00:00:00Z',
      diagnostics: [],
      skills: [
        {
          id: 'skill-low',
          slug: 'low',
          title: 'Low priority',
          description: '',
          priority: 1,
          triggers: {
            phrases: ['landing page'],
            allOf: [],
            anyOf: [],
            minScore: 1,
          },
          bodyDocId: 'skill-low',
          bodyBytes: bigBody.length,
        },
        {
          id: 'skill-mid',
          slug: 'mid',
          title: 'Mid priority',
          description: '',
          priority: 5,
          triggers: {
            phrases: ['landing page'],
            allOf: [],
            anyOf: [],
            minScore: 1,
          },
          bodyDocId: 'skill-mid',
          bodyBytes: bigBody.length,
        },
        {
          id: 'skill-high',
          slug: 'high',
          title: 'High priority',
          description: '',
          priority: 9,
          triggers: {
            phrases: ['landing page'],
            allOf: [],
            anyOf: [],
            minScore: 1,
          },
          bodyDocId: 'skill-high',
          bodyBytes: bigBody.length,
        },
      ],
    };
    const repo = makeRepo({
      getManifest: vi.fn(async () => threeSkillManifest),
      getSkillBodies: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, body: bigBody })),
      ),
    });

    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: ['skill-low', 'skill-mid', 'skill-high'],
        userMessage: 'draft a landing page',
      },
      repo,
    );
    const skillIds = payload.blocks
      .filter((b) => b.kind === 'skill')
      .map((b) => b.skillId);

    // Matcher sorts by score-desc then priority-desc. All three tie on
    // score (one phrase hit each = 2); priority ordering breaks the
    // tie so `skill-high`, `skill-mid` land, `skill-low` is dropped.
    expect(skillIds).toEqual(['skill-high', 'skill-mid']);
    // Ensure the cap is SKILL_BUDGET_BYTES, not an arbitrary constant.
    const totalBodyBytes = payload.blocks
      .filter((b) => b.kind === 'skill')
      .reduce((acc, b) => acc + Buffer.byteLength(b.body, 'utf8'), 0);
    expect(totalBodyBytes).toBeLessThanOrEqual(SKILL_BUDGET_BYTES);
  });
});

describe('buildUserPromptPayload (attachments)', () => {
  it('inlines a small attachment and co-injects ingestion-filing', async () => {
    const repo = makeRepo({
      getExtractedAttachments: vi.fn(async () => [
        {
          id: 'att-1',
          filename: 'brief.txt',
          extractedText: 'small content',
          sizeBytes: 100,
        },
      ]),
      getIngestionFilingSkill: vi.fn(async () => ({
        id: 'skill-if',
        body: 'filing rules body',
      })),
    });

    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: [],
        userMessage: 'process this',
      },
      repo,
    );

    const kinds = payload.blocks.map((b) => b.kind);
    expect(kinds).toContain('attachment-inline');
    expect(kinds).toContain('ingestion-filing');

    const inline = payload.blocks.find((b) => b.kind === 'attachment-inline')!;
    expect(inline.title).toBe('brief.txt');
    expect(inline.body).toBe('small content');
    expect(inline.attachmentId).toBe('att-1');

    const filing = payload.blocks.find((b) => b.kind === 'ingestion-filing')!;
    expect(filing.body).toBe('filing rules body');
    expect(filing.sourceDocId).toBe('skill-if');
  });

  it('emits pointer-form block for a large attachment', async () => {
    // 10KB > ATTACHMENT_INLINE_THRESHOLD_BYTES (8KB) → pointer.
    const big = 'x'.repeat(10 * 1024);
    expect(big.length).toBeGreaterThan(ATTACHMENT_INLINE_THRESHOLD_BYTES);

    const repo = makeRepo({
      getExtractedAttachments: vi.fn(async () => [
        {
          id: 'att-1',
          filename: 'big.pdf',
          extractedText: big,
          sizeBytes: big.length,
        },
      ]),
      getIngestionFilingSkill: vi.fn(async () => ({
        id: 'skill-if',
        body: 'filing rules',
      })),
    });

    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: [],
        userMessage: 'process',
      },
      repo,
    );

    const pointer = payload.blocks.find((b) => b.kind === 'attachment-pointer');
    expect(pointer).toBeDefined();
    expect(payload.blocks.find((b) => b.kind === 'attachment-inline')).toBeUndefined();

    // The pointer body carries the user-facing question so the LLM has
    // a consistent prompt regardless of attachment metadata.
    expect(pointer!.title).toBe('big.pdf');
    expect(pointer!.body).toContain('file the full extracted text');
    expect(pointer!.body).toContain('section by section');
    expect(pointer!.attachmentId).toBe('att-1');
  });

  it('falls back to pointer form when the inline budget is exhausted', async () => {
    // Two attachments, each 6KB (< 8KB threshold so both are inline-
    // eligible). Inline budget is 12KB, so the first fits and the
    // second exceeds the running budget → pointer.
    const text = 'y'.repeat(6 * 1024);
    const repo = makeRepo({
      getExtractedAttachments: vi.fn(async () => [
        {
          id: 'att-a',
          filename: 'first.txt',
          extractedText: text,
          sizeBytes: text.length,
        },
        {
          id: 'att-b',
          filename: 'second.txt',
          extractedText: text,
          sizeBytes: text.length,
        },
        {
          id: 'att-c',
          filename: 'third.txt',
          extractedText: text,
          sizeBytes: text.length,
        },
      ]),
    });

    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: [],
        userMessage: 'process',
      },
      repo,
    );

    const byId = new Map(
      payload.blocks
        .filter((b) => b.kind === 'attachment-inline' || b.kind === 'attachment-pointer')
        .map((b) => [b.attachmentId, b]),
    );
    expect(byId.get('att-a')?.kind).toBe('attachment-inline');
    // Second attachment does not fit — budget left after first is 6KB
    // which equals this one's size (12KB - 6KB = 6KB remaining, and
    // `<=` allows equality), so it DOES inline.
    expect(byId.get('att-b')?.kind).toBe('attachment-inline');
    // Third attachment has no budget left → pointer.
    expect(byId.get('att-c')?.kind).toBe('attachment-pointer');
  });

  it('skips the ingestion-filing block when no attachments are present', async () => {
    const repo = makeRepo({
      // Returns a filing skill — but there are no attachments, so it
      // must never be fetched (and the block must never land).
      getIngestionFilingSkill: vi.fn(async () => ({
        id: 'skill-if',
        body: 'should not appear',
      })),
    });
    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: [],
        userMessage: 'hello',
      },
      repo,
    );
    expect(payload.blocks.some((b) => b.kind === 'ingestion-filing')).toBe(false);
    expect(repo.getIngestionFilingSkill).not.toHaveBeenCalled();
  });

  it('handles a missing ingestion-filing skill gracefully (Task 10 not yet seeded)', async () => {
    // Attachments present but the built-in filing skill hasn't been
    // seeded yet. The attachment block still lands; the filing block
    // is silently dropped.
    const repo = makeRepo({
      getExtractedAttachments: vi.fn(async () => [
        {
          id: 'att-1',
          filename: 'brief.txt',
          extractedText: 'content',
          sizeBytes: 100,
        },
      ]),
      getIngestionFilingSkill: vi.fn(async () => null),
    });
    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: [],
        userMessage: 'process',
      },
      repo,
    );
    expect(payload.blocks.some((b) => b.kind === 'attachment-inline')).toBe(true);
    expect(payload.blocks.some((b) => b.kind === 'ingestion-filing')).toBe(false);
  });
});

describe('buildUserPromptPayload (block ordering)', () => {
  it('orders blocks: attachments → ingestion-filing → skills', async () => {
    const repo = makeRepo({
      getExtractedAttachments: vi.fn(async () => [
        {
          id: 'att-1',
          filename: 'brief.txt',
          extractedText: 'small',
          sizeBytes: 50,
        },
      ]),
      getIngestionFilingSkill: vi.fn(async () => ({
        id: 'skill-if',
        body: 'filing',
      })),
    });
    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        agentSkillIds: ['c9f5e4a6-1'],
        userMessage: 'draft a landing page',
      },
      repo,
    );
    expect(payload.blocks.map((b) => b.kind)).toEqual([
      'attachment-inline',
      'ingestion-filing',
      'skill',
    ]);
  });
});

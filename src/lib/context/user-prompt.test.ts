// Unit tests for `buildUserPromptPayload`.
//
// The function is pure — a `UserPromptRepo` is injected so these tests
// never touch the DB. `repos.ts` owns the Drizzle-backed implementation
// and is covered by a separate integration test.
//
// Post-skills-rewrite the builder only emits attachment blocks; skill
// matching + ingestion-filing co-injection have been removed. See
// `src/lib/skills/README.md` for the progressive-disclosure model.

import { describe, it, expect, vi } from 'vitest';

import { ATTACHMENT_INLINE_THRESHOLD_BYTES } from './budgets';
import type { UserPromptRepo } from './user-prompt';
import { buildUserPromptPayload } from './user-prompt';

function makeRepo(overrides: Partial<UserPromptRepo> = {}): UserPromptRepo {
  return {
    getExtractedAttachments: vi.fn(async () => []),
    ...overrides,
  };
}

describe('buildUserPromptPayload (attachments)', () => {
  it('inlines a small attachment', async () => {
    const repo = makeRepo({
      getExtractedAttachments: vi.fn(async () => [
        {
          id: 'att-1',
          filename: 'brief.txt',
          extractedText: 'small content',
          sizeBytes: 100,
        },
      ]),
    });

    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        userMessage: 'process this',
      },
      repo,
    );

    expect(payload.blocks).toHaveLength(1);
    const inline = payload.blocks[0];
    expect(inline.kind).toBe('attachment-inline');
    expect(inline.title).toBe('brief.txt');
    expect(inline.body).toBe('small content');
    expect(inline.attachmentId).toBe('att-1');
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
    });

    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
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
    // Three attachments, each 6KB (< 8KB threshold so all are inline-
    // eligible). Inline budget is 12KB, so the first two fit exactly
    // and the third overflows → pointer.
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
    // Second attachment fits: budget left after first is 6KB and this
    // one's size is 6KB (<=6KB allows equality).
    expect(byId.get('att-b')?.kind).toBe('attachment-inline');
    // Third attachment has no budget left → pointer.
    expect(byId.get('att-c')?.kind).toBe('attachment-pointer');
  });

  it('returns an empty payload when there are no attachments', async () => {
    const repo = makeRepo();
    const payload = await buildUserPromptPayload(
      {
        companyId: 'co-1',
        sessionId: 's-1',
        userMessage: 'hello',
      },
      repo,
    );
    expect(payload.blocks).toHaveLength(0);
  });
});

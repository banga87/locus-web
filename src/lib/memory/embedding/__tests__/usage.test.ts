import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordUsageMock = vi.fn();
vi.mock('@/lib/usage/record', () => ({
  recordUsage: (args: unknown) => recordUsageMock(args),
}));

import { recordEmbeddingUsage } from '../usage';

describe('recordEmbeddingUsage', () => {
  beforeEach(() => recordUsageMock.mockReset());

  it('writes a usage_records row with the embedding-worker source', async () => {
    recordUsageMock.mockResolvedValueOnce({ id: 'fake-id' });

    await recordEmbeddingUsage({
      companyId: 'co-1',
      brainId: 'br-1',
      documentId: 'doc-1',
      promptTokens: 250,
    });

    expect(recordUsageMock).toHaveBeenCalledOnce();
    const args = recordUsageMock.mock.calls[0][0];
    expect(args.companyId).toBe('co-1');
    expect(args.modelId).toBe('openai/text-embedding-3-small');
    expect(args.inputTokens).toBe(250);
    expect(args.outputTokens).toBe(0);
    expect(args.totalTokens).toBe(250);
    expect(args.source).toBe('embedding_worker');
    expect(args.userId).toBeNull();
    expect(args.sessionId).toBeNull();
  });

  it('returns null without throwing when recordUsage returns null', async () => {
    recordUsageMock.mockResolvedValueOnce(null);
    await expect(
      recordEmbeddingUsage({
        companyId: 'co-1',
        brainId: 'br-1',
        documentId: 'doc-1',
        promptTokens: 0,
      }),
    ).resolves.toBeNull();
  });
});

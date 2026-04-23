import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI SDK embed/embedMany + Gateway provider before importing
// the module under test. Gateway is the auth path (OIDC); the mock
// returns a fake model handle that openai.test.ts doesn't introspect.
const embedMock = vi.fn();
const embedManyMock = vi.fn();
vi.mock('ai', () => ({
  embed: (args: unknown) => embedMock(args),
  embedMany: (args: unknown) => embedManyMock(args),
}));
vi.mock('@ai-sdk/gateway', () => ({
  gateway: { textEmbeddingModel: (id: string) => ({ id }) },
}));

import { openaiEmbedder } from '../openai';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL_ID } from '../types';

describe('openaiEmbedder', () => {
  beforeEach(() => {
    embedMock.mockReset();
    embedManyMock.mockReset();
  });

  it('embed() returns a vector of the right dimension and the prompt token count', async () => {
    const fakeVec = new Array(EMBEDDING_DIMENSION).fill(0.123);
    embedMock.mockResolvedValueOnce({ embedding: fakeVec, usage: { tokens: 17 } });

    const out = await openaiEmbedder.embed('hello world');

    expect(out.vector).toEqual(fakeVec);
    expect(out.vector.length).toBe(EMBEDDING_DIMENSION);
    expect(out.promptTokens).toBe(17);
    expect(embedMock).toHaveBeenCalledOnce();
  });

  it('embedMany() returns one result per input', async () => {
    const fakeVec = new Array(EMBEDDING_DIMENSION).fill(0.5);
    embedManyMock.mockResolvedValueOnce({
      embeddings: [fakeVec, fakeVec, fakeVec],
      usage: { tokens: 30 },
    });

    const out = await openaiEmbedder.embedMany(['a', 'b', 'c']);

    expect(out).toHaveLength(3);
    expect(out[0].vector).toEqual(fakeVec);
    // promptTokens divided pro-rata across the batch (OpenAI returns total only).
    expect(out[0].promptTokens + out[1].promptTokens + out[2].promptTokens).toBe(30);
  });

  it('describe() returns the model id and dimension', () => {
    expect(openaiEmbedder.describe()).toEqual({
      model: EMBEDDING_MODEL_ID,
      dimension: EMBEDDING_DIMENSION,
    });
  });
});

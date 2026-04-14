import { describe, expect, it, vi } from 'vitest';

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));
vi.mock('ai', () => ({ generateText: generateTextMock }));
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (id: string) => ({ id }) }));

import { extract, EXTRACTOR_SYSTEM_PROMPT } from '../extractor';

describe('webfetch/extractor', () => {
  it('calls generateText with correct model, system prompt, user-prompt-first ordering, maxOutputTokens=2000', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'compressed answer',
      usage: { inputTokens: 4000, outputTokens: 200, totalTokens: 4200 },
    });

    const out = await extract({
      url: 'https://example.com',
      markdown: '# Page\n\nbody',
      prompt: 'Extract pricing',
      abortSignal: new AbortController().signal,
    });

    expect(out).toEqual({
      kind: 'ok',
      text: 'compressed answer',
      usage: { inputTokens: 4000, outputTokens: 200, totalTokens: 4200 },
    });

    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      system: EXTRACTOR_SYSTEM_PROMPT,
      maxOutputTokens: 2000,
    }));

    const args = generateTextMock.mock.calls[0][0];
    expect(args.model).toEqual({ id: 'claude-haiku-4-5-20251001' });
    // Verify the user prompt precedes the web content.
    const userPromptIdx = args.prompt.indexOf('<user_prompt>');
    const webContentIdx = args.prompt.indexOf('<web_content');
    expect(userPromptIdx).toBeGreaterThanOrEqual(0);
    expect(webContentIdx).toBeGreaterThan(userPromptIdx);
    expect(args.prompt).toContain('Extract pricing');
    expect(args.prompt).toContain('# Page');
    expect(args.prompt).toContain('url="https://example.com"');
  });

  it('returns kind=extraction_failed on generateText throw', async () => {
    generateTextMock.mockRejectedValueOnce(new Error('LLM down'));
    const out = await extract({
      url: 'https://x.com',
      markdown: 'body',
      prompt: 'p',
      abortSignal: new AbortController().signal,
    });
    expect(out.kind).toBe('extraction_failed');
  });

  it('returns kind=extraction_failed on empty text', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: '',
      usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
    });
    const out = await extract({
      url: 'https://x.com', markdown: 'body', prompt: 'p', abortSignal: new AbortController().signal,
    });
    expect(out.kind).toBe('extraction_failed');
  });
});

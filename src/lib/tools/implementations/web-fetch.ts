import type { LocusTool, ToolContext, ToolResult } from '../types';
import { scrape } from '@/lib/webfetch/firecrawl-client';
import { extract, HAIKU_MODEL_ID } from '@/lib/webfetch/extractor';
import { recordFirecrawlUsage } from '@/lib/usage/firecrawl';
import { recordUsage } from '@/lib/usage/record';
import type { ScrapeOutcome } from '@/lib/webfetch/types';

const PER_TURN_LIMIT = 15;
const CHARS_PER_TOKEN = 4;

/** 100k tokens worth of characters — triggers truncation. */
export const TRUNCATE_THRESHOLD_CHARS = 100_000 * CHARS_PER_TOKEN;
/** 500k tokens worth of characters — rejected even after truncation would apply. */
export const REJECT_THRESHOLD_CHARS = 500_000 * CHARS_PER_TOKEN;

const SCRAPE_TIMEOUT_MS = 60_000;
const EXTRACT_TIMEOUT_MS = 30_000;

interface WebFetchInput {
  url: string;
  prompt: string;
}

interface WebFetchOutput {
  url: string;
  title?: string;
  extracted: string;
}

export const webFetchTool: LocusTool<WebFetchInput, WebFetchOutput> = {
  name: 'web_fetch',
  description:
    'Fetch a web page and return a compressed extraction of content relevant to your prompt. ' +
    'The extraction is performed by a smaller model — your prompt describes what to extract. ' +
    "Use web_search first if you don't know the URL.",
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', minLength: 1, pattern: '^https?://' },
      prompt: { type: 'string', minLength: 10, maxLength: 1000 },
    },
    required: ['url', 'prompt'],
    additionalProperties: false,
  },
  capabilities: ['web'],

  action: 'read' as const,

  isReadOnly() { return true; },

  async call(input, context): Promise<ToolResult<WebFetchOutput>> {
    if (process.env.FIRECRAWL_ENABLED === 'false') {
      return buildError('disabled', 'Web access is temporarily disabled.', {
        hint: 'Contact ops to re-enable.', retryable: false,
      });
    }

    if (context.webCallsThisTurn >= PER_TURN_LIMIT) {
      return buildError(
        'per_turn_limit_exceeded',
        `Web call limit (${PER_TURN_LIMIT}) reached for this turn.`,
        { hint: 'Continue the conversation; web access resets on the next turn.', retryable: false },
      );
    }

    if (!/^https?:\/\//.test(input.url)) {
      return buildError('invalid_url', 'URL must start with http:// or https://', {
        hint: 'Correct the scheme and retry.', retryable: false,
      });
    }

    context.webCallsThisTurn += 1;

    const abortSignal = context.abortSignal ?? new AbortController().signal;

    const scrapeOutcome = await withTimeout(
      scrape({ url: input.url, signal: abortSignal }),
      SCRAPE_TIMEOUT_MS,
    );
    if (scrapeOutcome === 'timeout') {
      return buildError('scrape_timeout', 'Firecrawl scrape exceeded 60s.', {
        hint: 'The URL is slow or unreachable.', retryable: true,
      });
    }
    if (scrapeOutcome.kind !== 'ok') {
      return mapScrapeError(scrapeOutcome);
    }

    // Record the Firecrawl credit regardless of downstream extractor success —
    // Firecrawl already billed us for the scrape.
    await recordFirecrawlUsage({
      companyId: context.companyId,
      sessionId: context.sessionId ?? null,
      userId: context.actor.type === 'human' ? context.actor.id : null,
      tool: 'web_fetch',
      credits: 1,
      url: input.url,
    });

    let markdown = scrapeOutcome.markdown;
    if (markdown.length > REJECT_THRESHOLD_CHARS) {
      return buildError('content_too_large',
        `Scraped markdown exceeds ~500k token cap (${markdown.length} chars).`,
        { hint: 'Narrow the URL or use web_search to find a more specific page.', retryable: false },
      );
    }
    if (markdown.length > TRUNCATE_THRESHOLD_CHARS) {
      markdown = markdown.slice(0, TRUNCATE_THRESHOLD_CHARS) + '\n\n[...content truncated...]';
    }

    const extractOutcome = await withTimeout(
      extract({
        url: input.url,
        markdown,
        prompt: input.prompt,
        abortSignal,
      }),
      EXTRACT_TIMEOUT_MS,
    );
    if (extractOutcome === 'timeout') {
      return buildError('extraction_timeout', 'Extractor exceeded 30s.', {
        hint: 'Rare — try a different URL.', retryable: true,
      });
    }
    if (extractOutcome.kind !== 'ok') {
      return buildError('extraction_failed', extractOutcome.message, {
        hint: 'Content may be unusable.', retryable: false,
      });
    }

    await recordUsage({
      companyId: context.companyId,
      sessionId: context.sessionId ?? null,
      userId: context.actor.type === 'human' ? context.actor.id : null,
      modelId: `anthropic/${HAIKU_MODEL_ID}`,
      inputTokens: extractOutcome.usage.inputTokens,
      outputTokens: extractOutcome.usage.outputTokens,
      totalTokens: extractOutcome.usage.totalTokens,
    });

    return {
      success: true,
      data: {
        url: input.url,
        title: scrapeOutcome.title,
        extracted: extractOutcome.text,
      },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: [],
        details: {
          eventType: 'web.fetch',
          url: input.url,
          extractorInputTokens: extractOutcome.usage.inputTokens,
          extractorOutputTokens: extractOutcome.usage.outputTokens,
        },
      },
    };
  },
};

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    p,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms)),
  ]);
}

function mapScrapeError(outcome: Exclude<ScrapeOutcome, { kind: 'ok' }>): ToolResult<WebFetchOutput> {
  if (outcome.kind === 'rate_limited') {
    return buildError('rate_limited', 'Firecrawl rate limit hit.', {
      hint: 'Retry after a short delay.', retryable: true,
    });
  }
  if (outcome.kind === 'provider_error') {
    return buildError('provider_error', outcome.message, {
      hint: 'Transient — safe to retry once.', retryable: true,
    });
  }
  if (outcome.kind === 'scrape_failed') {
    return buildError('scrape_failed', outcome.message, {
      hint: 'The URL may be blocked or unreachable. Try a different page.', retryable: false,
    });
  }
  return buildError('network_error', outcome.message, {
    hint: 'Check Firecrawl connectivity.', retryable: true,
  });
}

function buildError(
  code: string,
  message: string,
  opts: { hint?: string; retryable: boolean },
): ToolResult<WebFetchOutput> {
  return {
    success: false,
    error: { code, message, ...opts },
    metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
  };
}

import type { LocusTool, ToolContext, ToolResult } from '../types';
import { search } from '@/lib/webfetch/firecrawl-client';
import { recordFirecrawlUsage } from '@/lib/usage/firecrawl';

const PER_TURN_LIMIT = 15;

interface WebSearchInput {
  query: string;
  limit?: number;
}

interface WebSearchOutput {
  results: Array<{ url: string; title: string; snippet: string }>;
}

export const webSearchTool: LocusTool<WebSearchInput, WebSearchOutput> = {
  name: 'web_search',
  description:
    'Search the public web and return a list of URLs with titles and snippets. ' +
    'Use web_fetch afterward to extract content from a promising result. Max 10 results per call.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  capabilities: ['web'],

  isReadOnly() { return true; },

  async call(input, context): Promise<ToolResult<WebSearchOutput>> {
    const limit = input.limit ?? 5;

    if (process.env.FIRECRAWL_ENABLED === 'false') {
      return buildError('disabled', 'Web access is temporarily disabled.', {
        hint: 'Contact ops to re-enable.',
        retryable: false,
      });
    }

    if (context.webCallsThisTurn >= PER_TURN_LIMIT) {
      return buildError(
        'per_turn_limit_exceeded',
        `Web call limit (${PER_TURN_LIMIT}) reached for this turn.`,
        {
          hint: 'Continue the conversation; web access resets on the next turn.',
          retryable: false,
        },
      );
    }

    context.webCallsThisTurn += 1;

    const outcome = await search({ query: input.query, limit });
    if (outcome.kind !== 'ok') {
      return mapSearchError(outcome);
    }

    await recordFirecrawlUsage({
      companyId: context.companyId,
      sessionId: context.sessionId ?? null,
      userId: context.actor.type === 'human' ? context.actor.id : null,
      tool: 'web_search',
      credits: 1,
    });

    return {
      success: true,
      data: { results: outcome.results },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: [],
        details: {
          eventType: 'web.search',
          query: input.query,
          resultCount: outcome.results.length,
        },
      },
    };
  },
};

function mapSearchError(
  outcome:
    | { kind: 'rate_limited' }
    | { kind: 'provider_error'; message: string }
    | { kind: 'network_error'; message: string },
): ToolResult<WebSearchOutput> {
  if (outcome.kind === 'rate_limited') {
    return buildError('rate_limited', 'Firecrawl rate limit hit.', {
      hint: 'Retry after a short delay.',
      retryable: true,
    });
  }
  if (outcome.kind === 'provider_error') {
    return buildError('provider_error', outcome.message, {
      hint: 'Transient — safe to retry once.',
      retryable: true,
    });
  }
  return buildError('network_error', outcome.message, {
    hint: 'Check Firecrawl connectivity.',
    retryable: true,
  });
}

function buildError(
  code: string,
  message: string,
  opts: { hint?: string; retryable: boolean },
): ToolResult<WebSearchOutput> {
  return {
    success: false,
    error: { code, message, ...opts },
    metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
  };
}

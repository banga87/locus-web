import { AxiomJSTransport, Logger } from '@axiomhq/logging';
import { createAxiomRouteHandler, nextJsFormatters } from '@axiomhq/nextjs';
import type { NextRequest } from 'next/server';

import axiomClient from '@/lib/axiom/axiom';

export const logger = new Logger({
  transports: [
    new AxiomJSTransport({
      axiom: axiomClient,
      dataset: process.env.AXIOM_DATASET!,
    }),
  ],
  formatters: nextJsFormatters,
});

const baseWithAxiom = createAxiomRouteHandler(logger);

type RouteHandler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<Response> | Response;

// Collapses AI-SDK chat-shape bodies (`{ messages: UIMessage[], ... }`) so
// we log only the latest turn instead of the entire replayed conversation.
// Non-chat bodies pass through untouched.
function summarizeBody(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    'messages' in parsed &&
    Array.isArray((parsed as { messages: unknown }).messages)
  ) {
    const { messages, ...rest } = parsed as { messages: unknown[] } & Record<string, unknown>;
    return {
      ...rest,
      messageCount: messages.length,
      latestMessage: messages[messages.length - 1] ?? null,
    };
  }
  return parsed;
}

// Wraps a route handler with Axiom req/res logging. When AXIOM_LOG_BODY=1 is
// set, also logs the raw request body as a separate event before delegating —
// useful for inspecting incoming params, but never leave on in production:
// bodies can contain PII, tokens, or large payloads (esp. ingestion/chat).
export function withAxiom<Ctx = unknown>(handler: RouteHandler<Ctx>): RouteHandler<Ctx> {
  return baseWithAxiom(async (req, ctx) => {
    if (process.env.AXIOM_LOG_BODY === '1' && req.body) {
      try {
        const raw = await req.clone().text();
        logger.info('request.body', {
          method: req.method,
          path: req.nextUrl.pathname,
          body: summarizeBody(raw),
        });
      } catch {
        // body may be unreadable (already consumed, streaming, etc.) — skip.
      }
    }
    return handler(req, ctx);
  }) as RouteHandler<Ctx>;
}

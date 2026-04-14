// POST /api/agent/chat — Platform Agent streaming chat.
//
// This route is a **pure adapter** — it does not import `streamText`
// directly. All harness concerns (hook bus, prompt caching, model
// selection, abort propagation, stream assembly) live in
// `runAgentTurn`. The route's job is HTTP ↔ context translation:
//   1. Parse the AI SDK `useChat` request body.
//   2. Resolve the auth context (`companyId`, `userId`, `brainId`).
//   3. Build the system prompt + tool set.
//   4. Delegate to `runAgentTurn`.
//   5. Hand back `result.toUIMessageStreamResponse()`.
//   6. After completion, persist usage + audit + (Task 2) the session turn.
//
// Stubs:
//   - `sessionManager` is a no-op until Task 2 ships per-turn persistence.
//     The real implementation lives at `@/lib/sessions/manager`. The route
//     reads from / writes to the stub through a single import surface so
//     Task 2 only has to swap that one module.
//
// MCP OUT:
//   `loadMcpOutTools` returns `{ tools, close }`. The `close` callback
//   releases every open transport opened during discovery. We invoke it
//   via `waitUntil` in all terminal paths (deny branch + normal stream)
//   so the stream isn't blocked on transport teardown but the closes
//   still land before the function shuts down.
//
// Runtime: Node.js (we use `waitUntil` from `@vercel/functions`, which
// requires the Node runtime; we also need long-running streaming).
// `maxDuration = 120` covers a multi-step agent turn with tool use.

import { waitUntil } from '@vercel/functions';
import { and, eq } from 'drizzle-orm';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIMessage,
} from 'ai';

import { db } from '@/db';
import { categories, sessions } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { runAgentTurn, DEFAULT_MODEL } from '@/lib/agent/run';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';
import { buildToolSet } from '@/lib/agent/tool-bridge';
import type { AgentContext } from '@/lib/agent/types';
import { getBrainForCompany } from '@/lib/brain/queries';
import { registerContextHandlers } from '@/lib/context/register';
import { registerLocusTools } from '@/lib/tools';
import { recordUsage } from '@/lib/usage/record';
import { flushEvents } from '@/lib/audit/logger';
import { sessionManager } from '@/lib/sessions/manager';
import { loadMcpOutTools } from '@/lib/mcp-out/bridge';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface ChatRequestBody {
  /** UI message history from `useChat()` (the v6 shape). */
  messages: UIMessage[];
  /** Active session id — null on first message before a session exists. */
  sessionId: string | null;
}

export async function POST(req: Request) {
  // Phase 0 tools register lazily — make sure they're in the registry
  // before `buildToolSet()` enumerates. Idempotent.
  registerLocusTools();
  // Phase 1.5 context-injection handlers (SessionStart etc). Idempotent
  // — the module-level `registered` guard makes subsequent calls a
  // no-op. Call it here instead of a shared boot module because the
  // agent harness must stay platform-agnostic (see AGENTS.md); this
  // route already imports `@/db` via `sessionManager` and friends, so
  // the Drizzle-backed context repo's imports don't widen the
  // harness-boundary surface.
  registerContextHandlers();

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  let auth;
  try {
    auth = await requireAuth();
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.statusCode },
      );
    }
    throw err;
  }

  if (!auth.companyId) {
    return Response.json(
      { error: 'no_company', message: 'Complete setup before using chat.' },
      { status: 403 },
    );
  }

  const brain = await getBrainForCompany(auth.companyId);
  const cats = await db
    .select({
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
    })
    .from(categories)
    .where(eq(categories.brainId, brain.id));

  // Resolve the company name for the system prompt. We already have the
  // company id from auth; one more cheap query keeps the prompt builder
  // pure (no DB lookups inside the harness).
  const { companies } = await import('@/db/schema');
  const [companyRow] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, auth.companyId))
    .limit(1);

  // Phase 1.5 Task 9 — resolve the session's active agent-definition id
  // so the SessionStart + UserPromptSubmit handlers can load the right
  // scaffolding, baseline docs, persona snippet, and skill candidate
  // pool. Scoped by `companyId` as defence-in-depth: even if a caller
  // passes a `sessionId` that belongs to a different tenant (RLS blocks
  // this on the Supabase auth-scoped client, but `db` here is the
  // service-role connection), the AND-clause guarantees we never pull
  // an agent-definition across tenant boundaries. A `null` column
  // value means the session is using the default Platform Agent —
  // SessionStart then injects scaffolding only, with no baselines or
  // persona snippet; UserPromptSubmit skips skill matching entirely
  // (empty candidate pool short-circuits the manifest fetch).
  //
  // Follow-up: sessions are currently created with `agent_definition_
  // id = NULL` everywhere (see POST /api/agent/sessions). The UI to
  // assign an agent to a new session lives on the Phase 1.5 wizard
  // roadmap; wiring that POST body through is a separate task (see
  // plan §Task 9 notes). Until then every chat request resolves to
  // NULL here, which matches the pre-1.5 behaviour bit for bit.
  let agentDefinitionId: string | null = null;
  if (body.sessionId) {
    const [sessionRow] = await db
      .select({ agentDefinitionId: sessions.agentDefinitionId })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, body.sessionId),
          eq(sessions.companyId, auth.companyId),
        ),
      )
      .limit(1);
    agentDefinitionId = sessionRow?.agentDefinitionId ?? null;
  }

  const ctx: AgentContext = {
    actor: {
      type: 'platform_agent',
      userId: auth.userId,
      companyId: auth.companyId,
      scopes: ['read'],
    },
    brainId: brain.id,
    companyId: auth.companyId,
    sessionId: body.sessionId,
    agentDefinitionId,
    abortSignal: req.signal,
    // Task 11 will derive this from the agent-definition's tool-allowlist.
    // Platform Agent default: ['web'] so web_search + web_fetch are
    // visible to the LLM once the implementations land.
    grantedCapabilities: ['web'],
  };

  // Task 2 will load prior turns from `session_turns` and prepend them to
  // the message array. The stub returns []; the chat round trip works
  // (you just lose conversational memory across requests).
  const priorMessages: ModelMessage[] = body.sessionId
    ? await sessionManager.getContext(body.sessionId)
    : [];

  // Convert UI messages from useChat to ModelMessages for the LLM.
  // v6's converter is async (it can resolve URL data parts on the way).
  const incomingModelMessages = await convertToModelMessages(body.messages);

  // Tools discovered from the company's connected MCP OUT servers.
  // `close` must be invoked once the turn is done so per-request MCP
  // transports are released; we defer via `waitUntil` below in every
  // terminal path so teardown doesn't block the response stream.
  const { tools: externalTools, close: closeMcp } = await loadMcpOutTools(
    auth.companyId,
  );

  const { result, denied } = await runAgentTurn({
    ctx,
    system: buildSystemPrompt({
      brain,
      companyName: companyRow?.name ?? 'your company',
      categories: cats,
    }),
    messages: [...priorMessages, ...incomingModelMessages],
    tools: buildToolSet(
      // Convert AgentContext.actor.userId → ToolContext.actor.id and
      // map `platform_agent` to the audit ActorType. ToolContext also
      // wants `brainId` + `companyId` flat.
      {
        actor: {
          type: 'platform_agent',
          id: auth.userId,
          name: auth.fullName ?? undefined,
          scopes: ['read'],
        },
        companyId: auth.companyId,
        brainId: brain.id,
        sessionId: body.sessionId ?? undefined,
        abortSignal: req.signal,
        // Task 11 wires capability derivation properly; mirrors the
        // AgentContext above so buildToolSet sees the Platform Agent
        // defaults.
        grantedCapabilities: ['web'],
        webCallsThisTurn: 0,
      },
      externalTools,
    ),
    maxSteps: 6,
    onFinish: (finish) => {
      // Persist + bill on the side. `waitUntil` keeps the function alive
      // long enough for the writes after the response stream closes; we
      // never await these inline because that would block the stream.
      waitUntil(
        (async () => {
          if (body.sessionId) {
            await sessionManager.persistTurn({
              sessionId: body.sessionId,
              userMessage: body.messages[body.messages.length - 1],
              assistantMessage: finish.response.messages,
              toolCalls: finish.toolCalls,
              usage: finish.usage,
            });
          }
          await recordUsage({
            companyId: auth.companyId!,
            sessionId: body.sessionId,
            userId: auth.userId,
            modelId: `anthropic/${DEFAULT_MODEL}`,
            inputTokens: finish.usage.inputTokens ?? 0,
            outputTokens: finish.usage.outputTokens ?? 0,
            totalTokens: finish.usage.totalTokens ?? 0,
            cachedInputTokens:
              finish.usage.inputTokenDetails?.cacheReadTokens ??
              finish.usage.cachedInputTokens,
          });
          await flushEvents();
        })(),
      );
    },
  });

  // Deny path: SessionStart refused the turn. runAgentTurn returned
  // result: null; build a properly-terminated empty UI message stream
  // that writes a single text part with the denial reason and closes.
  // HTTP status stays 200 so the browser's EventSource doesn't reject —
  // the denial is visible to the user as the message content, and Stop
  // fired with reason='denied' inside runAgentTurn.
  if (!result) {
    // Release MCP transports on the deny path — the tools were opened
    // but will never be called.
    waitUntil(closeMcp());

    const reason = denied?.reason ?? 'denied';
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const textId = 'denial-0';
        writer.write({ type: 'text-start', id: textId });
        writer.write({
          type: 'text-delta',
          id: textId,
          delta: `Session denied: ${reason}`,
        });
        writer.write({ type: 'text-end', id: textId });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  // Normal path: schedule MCP transport teardown after the response
  // stream closes. `waitUntil` keeps the function alive long enough for
  // the close to complete without blocking the stream delivery.
  waitUntil(closeMcp());

  return result.toUIMessageStreamResponse();
}

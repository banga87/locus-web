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
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIMessage,
} from 'ai';

import { db } from '@/db';
import { documents, folders, sessions } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { runAgentTurn, DEFAULT_MODEL } from '@/lib/agent/run';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';
import { buildToolSet } from '@/lib/agent/tool-bridge';
import type { AgentActor, AgentContext } from '@/lib/agent/types';
import { getBrainForCompany } from '@/lib/brain/queries';
import { parseFrontmatterRaw } from '@/lib/brain/save';
import { registerContextHandlers } from '@/lib/context/register';
import {
  createDbAgentCapabilitiesRepo,
  createDbAgentSkillsRepo,
} from '@/lib/context/repos';
import { deriveGrantedCapabilities } from './grantedCapabilities';
import { registerLocusTools } from '@/lib/tools';
import { recordUsage } from '@/lib/usage/record';
import { flushEvents } from '@/lib/audit/logger';
import { sessionManager } from '@/lib/sessions/manager';
import { loadMcpOutTools } from '@/lib/mcp-out/bridge';
import { logger as axiomLogger } from '@/lib/axiom/server';

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
  const folderRows = await db
    .select({
      slug: folders.slug,
      name: folders.name,
      description: folders.description,
    })
    .from(folders)
    .where(eq(folders.brainId, brain.id));

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

  // Task 11: load the agent-definition's `capabilities` field — only when
  // the session is tied to a user-built definition. When it's null, the
  // default Platform Agent behaviour kicks in (web enabled). Keeps the
  // load to a single-row query reusing the sessions-scoping indexes.
  let agentCapabilities: string[] | null = null;
  if (agentDefinitionId) {
    const capsRepo = createDbAgentCapabilitiesRepo();
    agentCapabilities = await capsRepo.getAgentCapabilities(agentDefinitionId);
  }

  // Phase 1.5 Task 9 (skills) — resolve the agent-definition's
  // `skills:` frontmatter array. Two payloads derive from it:
  //   1. `agentSkillIds` is threaded onto the ToolContext so
  //      `load_skill` / `read_skill_file` can gate reads on membership.
  //   2. `availableSkills` carries the rendered name + description the
  //      agent sees in the <available-skills> prompt block.
  // No agent-definition → both stay empty → pre-PR1 behaviour (no
  // skills injected, no skill tools usable).
  let agentSkillIds: string[] = [];
  if (agentDefinitionId) {
    const skillsRepo = createDbAgentSkillsRepo();
    agentSkillIds = (await skillsRepo.getAgentSkillIds(agentDefinitionId)) ?? [];
  } else {
    // Default Platform Agent (no agent-definition): expose every skill
    // the company has installed/authored. See spec § Phase-1 follow-up
    // for the plan to narrow this to an explicit seeded default agent-def.
    const rows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, auth.companyId),
          eq(documents.type, 'skill'),
          isNull(documents.deletedAt),
        ),
      );
    agentSkillIds = rows.map((r) => r.id);
  }

  let availableSkills: Array<{
    id: string;
    name: string;
    description: string;
  }> = [];
  if (agentSkillIds.length > 0) {
    // Pull the skill root docs the agent is allowlisted for. Filter
    // to the caller's company (defence-in-depth against a rogue
    // agent-definition carrying cross-tenant ids) and to
    // `type='skill'` (the allowlist is UUIDs — reject anything
    // that's since been retyped away from a skill).
    const visibleSkills = await db
      .select({
        id: documents.id,
        content: documents.content,
      })
      .from(documents)
      .where(
        and(
          inArray(documents.id, agentSkillIds),
          eq(documents.companyId, auth.companyId),
          eq(documents.type, 'skill'),
          isNull(documents.deletedAt),
        ),
      );

    availableSkills = visibleSkills
      .map((r) => {
        const fm = parseFrontmatterRaw(r.content);
        const name = typeof fm.name === 'string' ? fm.name : '';
        const description =
          typeof fm.description === 'string' ? fm.description : '';
        return { id: r.id, name, description };
      })
      .filter((s) => s.name && s.description);
  }

  const agentActor: AgentActor = {
    type: 'platform_agent',
    userId: auth.userId,
    companyId: auth.companyId,
    scopes: ['read'],
  };

  const grantedCapabilities = deriveGrantedCapabilities({
    actor: agentActor,
    agentCapabilities,
  });

  const ctx: AgentContext = {
    actor: agentActor,
    brainId: brain.id,
    companyId: auth.companyId,
    sessionId: body.sessionId,
    agentDefinitionId,
    abortSignal: req.signal,
    grantedCapabilities,
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
  const {
    tools: externalTools,
    toolMeta: externalToolMeta,
    connections: externalConnections,
    close: closeMcp,
  } = await loadMcpOutTools(auth.companyId);

  const { result, denied } = await runAgentTurn({
    ctx,
    system: buildSystemPrompt({
      brain,
      companyName: companyRow?.name ?? 'your company',
      folders: folderRows,
      externalConnections,
      availableSkills,
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
        grantedCapabilities,
        agentSkillIds,
        webCallsThisTurn: 0,
      },
      externalTools,
      externalToolMeta,
    ),
    maxSteps: 6,
    onFinish: (finish) => {
      // Emit a per-turn tool-call summary to Axiom. Fires once per turn
      // with every call the agent made — gives us visibility into what
      // tools ran without logging the full streamed message payload.
      if (finish.toolCalls?.length) {
        axiomLogger.info('agent.toolCalls', {
          sessionId: body.sessionId,
          userId: auth.userId,
          companyId: auth.companyId,
          count: finish.toolCalls.length,
          calls: finish.toolCalls.map((call) => ({
            toolName: call.toolName,
            input: call.input,
          })),
        });
      }

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

  // Normal path: defer MCP transport teardown until AFTER the response
  // stream completes. Calling `closeMcp()` synchronously — e.g.
  // `waitUntil(closeMcp())` — evaluates closeMcp immediately and races
  // with the stream; the transport then closes before the model has had
  // a chance to issue tool calls, and the SDK throws "Not connected" on
  // `client.callTool(...)`. Chaining off `result.finishReason` waits for
  // the turn to end (success or error) and only then tears down the
  // transports, while waitUntil keeps the function alive.
  waitUntil(
    (async () => {
      try {
        await result.finishReason;
      } finally {
        await closeMcp();
      }
    })(),
  );

  return result.toUIMessageStreamResponse();
}

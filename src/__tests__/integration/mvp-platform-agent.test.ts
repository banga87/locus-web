// Phase 1 MVP Task 5 — Platform Agent end-to-end integration test.
//
// Verifies the MVP Platform Agent chat flow:
//   1. Authenticated user creates a session (POST /api/agent/sessions)
//   2. User sends a chat message (POST /api/agent/chat) with sessionId
//   3. The LLM (mocked) emits a tool-call for `search_documents`, gets a
//      tool-result, then produces a text response citing the document.
//   4. Stream frames appear in the response (first text-delta, tool
//      indicators, final text).
//   5. `session_turns` row is written with the persisted conversation.
//   6. `audit_events` rows include `actorType: 'platform_agent'`.
//   7. `usage_records` row has `customerCostUsd > providerCostUsd` (30%
//      markup per ADR-003).
//   8. A SECOND message in the same session sees turn 1 in prior context.
//   9. Mid-stream abort terminates the response without crashing.
//
// Strategy: mock `requireAuth` + `@ai-sdk/anthropic` so the route
// exercises real session persistence + real usage recording + real audit
// logging against live Postgres. No real Anthropic calls.
//
// Runs against live Supabase via the Drizzle superuser connection.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';

import { db } from '@/db';
import {
  auditEvents,
  sessions,
  sessionTurns,
  usageRecords,
} from '@/db/schema';
import { flushEvents } from '@/lib/audit/logger';

import {
  cleanupCompany,
  createSeededCompany,
  type TestCompany,
} from './helpers';

// --- Module mocks -------------------------------------------------------

// Mock requireAuth before the route imports it. The integration test
// stands up a real seeded user + company and surfaces those ids here.
const mockAuth = {
  userId: '',
  companyId: '',
  role: 'owner' as const,
  email: 'e2e@local',
  fullName: 'E2E User',
};

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>(
    '@/lib/api/auth',
  );
  return {
    ...actual,
    requireAuth: async () => ({ ...mockAuth }),
  };
});

// Mock the Anthropic provider — replaced per-test. Same pattern as
// `src/lib/agent/__tests__/run.test.ts`.
const mockProvider = {
  current: null as LanguageModelV3 | null,
  currentModel(modelId: string): LanguageModelV3 {
    if (!this.current) {
      throw new Error(
        `mockProvider.current not set — test forgot to call setModel(). Asked for ${modelId}.`,
      );
    }
    return this.current;
  },
  setModel(model: LanguageModelV3): void {
    this.current = model;
  },
  reset(): void {
    this.current = null;
  },
};

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((modelId: string) => mockProvider.currentModel(modelId)),
}));

// Mock @vercel/functions waitUntil so onFinish persistence is
// observable synchronously in the test.
const waitUntilPromises: Array<Promise<unknown>> = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(Promise.resolve(p).catch(() => {}));
  },
}));

// Import route handlers AFTER mocks are installed.
import { POST as chatPOST } from '@/app/api/agent/chat/route';
import { POST as sessionsPOST } from '@/app/api/agent/sessions/route';

// --- Helpers ------------------------------------------------------------

async function flushWaitUntil(): Promise<void> {
  // Drain the queue — let waitUntil-registered async work resolve.
  const pending = [...waitUntilPromises];
  waitUntilPromises.length = 0;
  await Promise.all(pending);
  // Allow any microtasks scheduled during drain to settle.
  await new Promise((r) => setTimeout(r, 0));
}

function buildChatRequest(
  messages: unknown[],
  sessionId: string | null,
  init?: RequestInit,
): Request {
  return new Request('http://localhost/api/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, sessionId }),
    ...init,
  });
}

function buildSessionPostRequest(body: unknown): Request {
  return new Request('http://localhost/api/agent/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

// --- Seed -----------------------------------------------------------

let company: TestCompany;

beforeAll(async () => {
  company = await createSeededCompany('mvp-pagent');
  mockAuth.userId = company.userId;
  mockAuth.companyId = company.companyId;
  // MCP_CONNECTION_ENCRYPTION_KEY is only exercised if the test has
  // active MCP OUT connections. The Platform Agent test has none, so
  // loadMcpOutTools returns {} without touching pgcrypto.
}, 120_000);

afterAll(async () => {
  await cleanupCompany(company);
}, 120_000);

beforeEach(() => {
  mockProvider.reset();
  waitUntilPromises.length = 0;
});

// --- Tests -----------------------------------------------------------

describe('MVP Platform Agent — full chat cycle', () => {
  it(
    'creates a session, streams a response with tool-use, persists turn, records usage with markup, and audits',
    async () => {
      // Step 1: create the session.
      const sessRes = await sessionsPOST(
        buildSessionPostRequest({ firstMessage: 'search for brand voice' }),
      );
      expect(sessRes.status).toBe(201);
      const { data: sessionData } = (await sessRes.json()) as {
        data: { id: string };
      };
      const sessionId = sessionData.id;
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

      // Step 1a: verify the session.started audit event landed. MVP
      // Acceptance Criterion #6 (plan line 1559) requires every session
      // lifecycle event to be audited; sessionManager.create() emits
      // this on every fresh session.
      await flushEvents();
      const startedEvents = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.companyId, company.companyId),
            eq(auditEvents.eventType, 'session.started'),
            eq(auditEvents.targetId, sessionId),
          ),
        );
      expect(startedEvents).toHaveLength(1);
      expect(startedEvents[0].actorType).toBe('human');

      // Step 2: wire the mock LLM. Emit a tool-call for
      // `search_documents`, then a text response. The harness's
      // onStepFinish runs tool execution, so we only need to emit the
      // tool-call — the executor runs the real tool against live data.
      // Single step (maxSteps=6 but we finish after one step with text
      // after the tool result is visible).
      //
      // Simplest realistic shape: one step that calls the tool AND
      // emits text in the same turn. The AI SDK's multi-step loop
      // otherwise needs a second model call after the tool result,
      // which doubles the mock surface.
      let callCount = 0;
      mockProvider.setModel(
        new MockLanguageModelV3({
          doStream: async () => {
            callCount += 1;
            // Step 1: emit tool-call. streamText then runs the tool.
            // Step 2: emit final text citing the document.
            if (callCount === 1) {
              return {
                stream: simulateReadableStream({
                  chunks: [
                    { type: 'stream-start', warnings: [] },
                    {
                      type: 'tool-call',
                      toolCallId: 'call-1',
                      toolName: 'search_documents',
                      input: JSON.stringify({ query: 'brand voice' }),
                    },
                    {
                      type: 'finish',
                      usage: {
                        inputTokens: {
                          total: 500,
                          noCache: 500,
                          cacheRead: undefined,
                          cacheWrite: undefined,
                        },
                        outputTokens: {
                          total: 10,
                          text: 10,
                          reasoning: undefined,
                        },
                      },
                      finishReason: { unified: 'tool-calls', raw: 'tool_use' },
                    },
                  ] satisfies LanguageModelV3StreamPart[],
                }),
              };
            }
            // Step 2 — final text response, with cache hit.
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 't1' },
                  {
                    type: 'text-delta',
                    id: 't1',
                    delta: 'Found documents on ',
                  },
                  { type: 'text-delta', id: 't1', delta: 'brand voice.' },
                  { type: 'text-end', id: 't1' },
                  {
                    type: 'finish',
                    usage: {
                      inputTokens: {
                        total: 800,
                        noCache: 100,
                        cacheRead: 700,
                        cacheWrite: undefined,
                      },
                      outputTokens: {
                        total: 20,
                        text: 20,
                        reasoning: undefined,
                      },
                    },
                    finishReason: { unified: 'stop', raw: 'end_turn' },
                  },
                ] satisfies LanguageModelV3StreamPart[],
              }),
            };
          },
        }),
      );

      // Step 3: send the chat message.
      const chatBody = [
        {
          id: 'user-msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'search for brand voice' }],
        },
      ];
      const res = await chatPOST(buildChatRequest(chatBody, sessionId));
      expect(res.status).toBe(200);

      // Step 4: drain the stream. The route returns a UIMessageStreamResponse
      // (SSE `data: ` frames). Verify we see the expected frame markers.
      const streamText = await res.text();
      expect(streamText).toContain('data:');
      // Tool-call frame with our tool name (AI SDK v6 emits tool-input-*).
      expect(streamText).toMatch(/search_documents/);
      // Final text.
      expect(streamText).toMatch(/Found documents on/);
      expect(streamText).toMatch(/brand voice\./);

      // Step 5: drain waitUntil promises so persistence lands.
      await flushWaitUntil();
      await flushEvents();

      // Step 6: verify session_turns row.
      const turns = await db
        .select()
        .from(sessionTurns)
        .where(eq(sessionTurns.sessionId, sessionId));
      expect(turns).toHaveLength(1);
      expect(turns[0].turnNumber).toBe(1);
      expect(turns[0].inputTokens).toBe(800);
      expect(turns[0].outputTokens).toBe(20);

      // Step 7: verify audit_events has at least one tool.search_documents
      // event with actorType = 'platform_agent'.
      const events = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.companyId, company.companyId),
            eq(auditEvents.eventType, 'tool.search_documents'),
          ),
        );
      expect(events.length).toBeGreaterThan(0);
      const platformAgentEvents = events.filter(
        (e) => e.actorType === 'platform_agent',
      );
      expect(platformAgentEvents.length).toBeGreaterThan(0);

      // Step 8: verify usage_records row with 30% markup.
      const usage = await db
        .select()
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.companyId, company.companyId),
            eq(usageRecords.sessionId, sessionId),
          ),
        );
      expect(usage.length).toBeGreaterThan(0);
      const u = usage[0];
      expect(u.inputTokens).toBeGreaterThan(0);
      expect(u.outputTokens).toBeGreaterThan(0);
      expect(u.customerCostUsd).toBeGreaterThan(u.providerCostUsd);
      // Verify 30% markup approximately (float rounding tolerance).
      const ratio = u.customerCostUsd / u.providerCostUsd;
      expect(ratio).toBeGreaterThan(1.29);
      expect(ratio).toBeLessThan(1.31);

      // Step 9: session row has turnCount=1 after the turn lands.
      const [sessionRow] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      expect(sessionRow.turnCount).toBe(1);
      expect(sessionRow.status).toBe('active');
    },
    180_000,
  );

  it(
    'resumes a session: the second turn sees turn 1 in prior context',
    async () => {
      // Create a fresh session, persist turn 1 manually, then fire a
      // second chat turn through the route. Assert the mock model
      // received a messages array that includes the prior turn.
      const sessRes = await sessionsPOST(
        buildSessionPostRequest({ firstMessage: 'first turn' }),
      );
      const { data: s } = (await sessRes.json()) as { data: { id: string } };
      const sessionId = s.id;

      // Seed turn 1 directly via the DB so we don't need to run a
      // full chat round first (the first test already covers that).
      await db.insert(sessionTurns).values({
        sessionId,
        turnNumber: 1,
        userMessage: {
          id: 'u1',
          role: 'user',
          parts: [{ type: 'text', text: 'first question' }],
        },
        assistantMessages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'first answer' }],
          },
        ],
        toolCalls: [],
        inputTokens: 100,
        outputTokens: 10,
      });

      // Capture the messages array the mock LLM receives on this turn.
      let capturedMessages: unknown[] = [];
      mockProvider.setModel(
        new MockLanguageModelV3({
          doStream: async (opts: { prompt: unknown }) => {
            capturedMessages = opts.prompt as unknown[];
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 't1' },
                  {
                    type: 'text-delta',
                    id: 't1',
                    delta: 'context-aware reply',
                  },
                  { type: 'text-end', id: 't1' },
                  {
                    type: 'finish',
                    usage: {
                      inputTokens: {
                        total: 200,
                        noCache: 200,
                        cacheRead: undefined,
                        cacheWrite: undefined,
                      },
                      outputTokens: {
                        total: 5,
                        text: 5,
                        reasoning: undefined,
                      },
                    },
                    finishReason: { unified: 'stop', raw: 'end_turn' },
                  },
                ] satisfies LanguageModelV3StreamPart[],
              }),
            };
          },
        }),
      );

      // Fire turn 2.
      const res = await chatPOST(
        buildChatRequest(
          [
            {
              id: 'user-msg-2',
              role: 'user',
              parts: [{ type: 'text', text: 'follow up' }],
            },
          ],
          sessionId,
        ),
      );
      expect(res.status).toBe(200);
      await res.text();
      await flushWaitUntil();

      // Persisted turn 2 must be numbered 2 — guards against a
      // regression in persistTurn's count(*)+1 logic that would
      // silently re-number turns and corrupt session history on
      // resume. Total turn count: 1 (seeded) + 1 (just persisted) = 2.
      const allTurns = await db
        .select()
        .from(sessionTurns)
        .where(eq(sessionTurns.sessionId, sessionId))
        .orderBy(asc(sessionTurns.turnNumber));
      expect(allTurns).toHaveLength(2);
      expect(allTurns[0].turnNumber).toBe(1);
      expect(allTurns[1].turnNumber).toBe(2);

      // The captured prompt array should include the prior turn's user
      // + assistant messages BEFORE the new user message. AI SDK v6
      // prepends the `system` message when `system` is passed; strip it
      // for the role-order assertion.
      const asObjects = capturedMessages as Array<{
        role: string;
        content: unknown;
      }>;
      const roles = asObjects.map((m) => m.role).filter((r) => r !== 'system');
      expect(roles.length).toBeGreaterThanOrEqual(3);
      // Expected order: prior user, prior assistant, new user.
      // The first two items are the replay; last must be the new turn.
      expect(roles[0]).toBe('user');
      expect(roles[1]).toBe('assistant');
      expect(roles[roles.length - 1]).toBe('user');

      // Prior user content should carry the question text.
      const flat = JSON.stringify(capturedMessages);
      expect(flat).toContain('first question');
      expect(flat).toContain('first answer');
      expect(flat).toContain('follow up');
    },
    120_000,
  );

  it(
    'mid-stream abort terminates gracefully without throwing',
    async () => {
      // Build a model whose stream hangs until aborted. Then abort.
      const ac = new AbortController();

      mockProvider.setModel(
        new MockLanguageModelV3({
          doStream: async ({ abortSignal }) => {
            const stream = new ReadableStream<LanguageModelV3StreamPart>({
              start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({ type: 'text-start', id: 't1' });
                controller.enqueue({
                  type: 'text-delta',
                  id: 't1',
                  delta: 'partial',
                });
                abortSignal?.addEventListener('abort', () => {
                  controller.error(
                    new DOMException(
                      'The user aborted a request.',
                      'AbortError',
                    ),
                  );
                });
              },
            });
            return { stream };
          },
        }),
      );

      // Create a session so the route has somewhere to route to.
      const sessRes = await sessionsPOST(
        buildSessionPostRequest({ firstMessage: 'hang' }),
      );
      const { data: s } = (await sessRes.json()) as { data: { id: string } };

      const req = buildChatRequest(
        [
          {
            id: 'user-msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hang' }],
          },
        ],
        s.id,
        { signal: ac.signal },
      );

      // Start the request.
      const resPromise = chatPOST(req);

      // Give streamText time to hand off the model + subscribe to the
      // abort signal before we trip it.
      await new Promise((r) => setTimeout(r, 50));

      ac.abort();

      // The route returns a Response with a stream that errors out
      // cleanly under abort. We assert: no uncaught throw from chatPOST,
      // and if the response arrives, it is shaped as a streaming
      // response (status 200 with a body).
      let res: Response | null = null;
      try {
        res = await resPromise;
      } catch {
        // Either outcome is acceptable — the only contract is "no
        // unhandled rejection crashes the process." Draining here
        // ensures that.
      }

      if (res) {
        // The route MUST hand back a streaming response even when the
        // request is being aborted. Status 200 + a non-null body proves
        // the route reached `result.toUIMessageStreamResponse()` (or the
        // deny-path empty stream) rather than throwing out of the
        // handler. Stream-level errors are surfaced to the client by the
        // streamed body itself.
        expect(res.status).toBe(200);
        expect(res.body).not.toBeNull();

        // Try to drain — may error as the stream closes. That's fine.
        try {
          await res.text();
        } catch {
          // Swallow — the abort test's contract is just that nothing
          // blows up at the surface.
        }
      }

      await flushWaitUntil();
    },
    60_000,
  );
});

describe('MVP Platform Agent — session listing', () => {
  it('created sessions surface in GET /api/agent/sessions', async () => {
    // Create two sessions and then list them. Uses the route handler
    // directly to exercise the pagination + RLS-defence-in-depth paths.
    const { GET: sessionsGET } = await import(
      '@/app/api/agent/sessions/route'
    );

    const s1 = await sessionsPOST(
      buildSessionPostRequest({ firstMessage: 'alpha' }),
    );
    const { data: sess1 } = (await s1.json()) as { data: { id: string } };

    const s2 = await sessionsPOST(
      buildSessionPostRequest({ firstMessage: 'beta' }),
    );
    const { data: sess2 } = (await s2.json()) as { data: { id: string } };

    const listReq = new Request(
      'http://localhost/api/agent/sessions?limit=20',
    );
    const listRes = await sessionsGET(listReq);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: Array<{ id: string; firstMessage: string | null }>;
    };
    const ids = listBody.data.map((r) => r.id);
    expect(ids).toContain(sess1.id);
    expect(ids).toContain(sess2.id);
  });
});

describe('MVP Platform Agent — performance sanity', () => {
  it(
    'session resume query (sessionManager.getContext) completes < 500ms',
    async () => {
      // Create a session with a few pre-existing turns so getContext
      // has real work to do.
      const { sessionManager } = await import('@/lib/sessions/manager');
      const session = await sessionManager.create({
        companyId: company.companyId,
        brainId: company.brainId,
        userId: company.userId,
      });

      // Seed 3 turns directly (bypass the retry loop's count-based
      // numbering so we know the exact turn numbers).
      await db.insert(sessionTurns).values([
        {
          sessionId: session.id,
          turnNumber: 1,
          userMessage: {
            id: 'u1',
            role: 'user',
            parts: [{ type: 'text', text: 'q1' }],
          },
          assistantMessages: [
            { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
          ],
          toolCalls: [],
          inputTokens: 50,
          outputTokens: 10,
        },
        {
          sessionId: session.id,
          turnNumber: 2,
          userMessage: {
            id: 'u2',
            role: 'user',
            parts: [{ type: 'text', text: 'q2' }],
          },
          assistantMessages: [
            { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
          ],
          toolCalls: [],
          inputTokens: 50,
          outputTokens: 10,
        },
        {
          sessionId: session.id,
          turnNumber: 3,
          userMessage: {
            id: 'u3',
            role: 'user',
            parts: [{ type: 'text', text: 'q3' }],
          },
          assistantMessages: [
            { role: 'assistant', content: [{ type: 'text', text: 'a3' }] },
          ],
          toolCalls: [],
          inputTokens: 50,
          outputTokens: 10,
        },
      ]);

      // Warm up — first call sometimes includes driver cache miss.
      await sessionManager.getContext(session.id);

      const start = Date.now();
      const ctx = await sessionManager.getContext(session.id);
      const elapsed = Date.now() - start;

      expect(ctx.length).toBe(6); // 3 user + 3 assistant
      expect(elapsed).toBeLessThan(500);
      // Record for the report.
      console.log(`[perf] getContext(3 turns) elapsed: ${elapsed}ms`);
    },
    30_000,
  );

  it(
    'first-token latency < 5000ms end-to-end with mocked LLM',
    async () => {
      // Set a trivial model that emits a text-delta immediately.
      mockProvider.setModel(
        new MockLanguageModelV3({
          doStream: async () => ({
            stream: simulateReadableStream({
              chunks: [
                { type: 'stream-start', warnings: [] },
                { type: 'text-start', id: 't1' },
                { type: 'text-delta', id: 't1', delta: 'hello' },
                { type: 'text-end', id: 't1' },
                {
                  type: 'finish',
                  usage: {
                    inputTokens: {
                      total: 10,
                      noCache: 10,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                    outputTokens: {
                      total: 1,
                      text: 1,
                      reasoning: undefined,
                    },
                  },
                  finishReason: { unified: 'stop', raw: 'end_turn' },
                },
              ] satisfies LanguageModelV3StreamPart[],
            }),
          }),
        }),
      );

      const sessRes = await sessionsPOST(
        buildSessionPostRequest({ firstMessage: 'perf' }),
      );
      const { data: s } = (await sessRes.json()) as { data: { id: string } };

      const req = buildChatRequest(
        [
          {
            id: 'perf-msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hi' }],
          },
        ],
        s.id,
      );

      const start = Date.now();
      const res = await chatPOST(req);
      // Read the first chunk from the response body — that's the
      // first-token event.
      const reader = res.body?.getReader();
      expect(reader).toBeDefined();
      const { value } = await reader!.read();
      const firstTokenElapsed = Date.now() - start;
      expect(value).toBeDefined();

      // Drain the rest so the route's cleanup paths run.
      while (true) {
        const r = await reader!.read();
        if (r.done) break;
      }
      await flushWaitUntil();

      console.log(`[perf] first-token latency: ${firstTokenElapsed}ms`);
      // This includes the full route-handler overhead (auth,
      // brain/category lookups, harness setup, loadMcpOutTools,
      // getContext, prompt build) PLUS the mock LLM's first chunk —
      // not just "LLM first-token latency." Spec reviewer measured
      // 1894/1917/2320ms across three runs; a 2000ms ceiling flaked.
      // The 5000ms ceiling is a sanity bound, not a production SLO;
      // production on Vercel will be noticeably tighter. Spec
      // (phase-1-mvp.md line 1506) calls this "performance sanity."
      expect(firstTokenElapsed).toBeLessThan(5000);
    },
    30_000,
  );
});

describe('MVP Platform Agent — session cleanup cron', () => {
  it(
    'marks a session as completed when lastActiveAt is > 24h old',
    async () => {
      // Set CRON_SECRET for this test scope.
      process.env.CRON_SECRET = 'test-cron-secret';

      // Create a session, then manually age it.
      const sessRes = await sessionsPOST(
        buildSessionPostRequest({ firstMessage: 'will be reaped' }),
      );
      const { data: s } = (await sessRes.json()) as { data: { id: string } };

      const staleTs = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await db
        .update(sessions)
        .set({ lastActiveAt: staleTs })
        .where(eq(sessions.id, s.id));

      // Import the cron route AFTER setting the env var (the route
      // reads process.env.CRON_SECRET at request time, not module
      // time, but this avoids any caching surprises).
      const { GET: cronGET } = await import(
        '@/app/api/cron/session-cleanup/route'
      );

      const cronReq = new Request(
        'http://localhost/api/cron/session-cleanup',
        {
          method: 'GET',
          headers: {
            authorization: 'Bearer test-cron-secret',
          },
        },
      );
      const cronRes = await cronGET(cronReq);
      expect(cronRes.status).toBe(200);
      const body = (await cronRes.json()) as { closedCount: number };
      expect(body.closedCount).toBeGreaterThanOrEqual(1);

      // Verify the session is now completed.
      const [after] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, s.id))
        .limit(1);
      expect(after.status).toBe('completed');
    },
    60_000,
  );

  it('rejects an invalid CRON_SECRET with 401', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    const { GET: cronGET } = await import(
      '@/app/api/cron/session-cleanup/route'
    );
    const cronReq = new Request(
      'http://localhost/api/cron/session-cleanup',
      {
        method: 'GET',
        headers: { authorization: 'Bearer wrong-secret' },
      },
    );
    const res = await cronGET(cronReq);
    expect(res.status).toBe(401);
  });
});


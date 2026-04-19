// Chat route test. Verifies the route delegates to `runAgentTurn` and
// adapts the result to a UI message stream response, without doing any
// of the harness work itself. The harness, hooks, tool bridge, and
// usage recorder all have their own unit tests — here we pin down the
// HTTP boundary:
//   - returns 401 when unauthenticated
//   - returns 403 when authenticated user has no companyId
//   - on a happy path, returns a streaming Response with the AI SDK
//     UI-message-stream content type
//   - propagates the request abort signal to runAgentTurn
//   - calls recordUsage with the model id + usage from finish

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module mocks. Hoisted by vitest above the route import so the route
// binds to these stubs.
const requireAuthMock = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  requireAuth: () => requireAuthMock(),
}));

vi.mock('@/lib/api/errors', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api/errors')>(
      '@/lib/api/errors',
    );
  return actual;
});

const getBrainForCompanyMock = vi.fn();
vi.mock('@/lib/brain/queries', () => ({
  getBrainForCompany: () => getBrainForCompanyMock(),
}));

const dbSelectMock = vi.fn();
vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          // Return an object that supports both:
          //   .limit(n)  — used by queries with an explicit limit
          //   await      — used by the fallback skill-ids query which has no .limit()
          // We make it a thenable so `await db.select().from().where()` resolves
          // via dbSelectMock(), while `.limit()` also calls dbSelectMock().
          const result = {
            limit: () => dbSelectMock(),
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(dbSelectMock()).then(resolve, reject),
          };
          return result;
        },
      }),
    }),
  },
}));

vi.mock('@/db/schema', () => ({
  folders: {},
  companies: {},
  // Task 9: the chat route now reads `sessions.agent_definition_id`
  // to populate `AgentContext.agentDefinitionId`. The mock below
  // hands `db.select()` a fake schema handle — Drizzle's `eq()` /
  // `and()` run against it symbolically, so truthy property
  // placeholders are all the chain needs. The shared `dbSelectMock`
  // returns the same stub row for both the companies lookup and the
  // sessions lookup; callers assert on the `ctx.agentDefinitionId`
  // projection downstream.
  sessions: {
    id: 'sessions.id',
    companyId: 'sessions.company_id',
    agentDefinitionId: 'sessions.agent_definition_id',
  },
  // Task 11: `createDbAgentCapabilitiesRepo` queries `documents` when the
  // session has an agent-definition bound. Truthy-placeholder fields are
  // enough for Drizzle's `eq()` / `and()` / `isNull()` to run symbolically.
  documents: {
    id: 'documents.id',
    type: 'documents.type',
    content: 'documents.content',
    deletedAt: 'documents.deleted_at',
  },
}));

const recordUsageMock = vi.fn(async (_: unknown) => {});
vi.mock('@/lib/usage/record', () => ({
  recordUsage: (args: unknown) => recordUsageMock(args),
}));

const flushEventsMock = vi.fn(async () => {});
vi.mock('@/lib/audit/logger', () => ({
  flushEvents: () => flushEventsMock(),
  logEvent: vi.fn(),
}));

vi.mock('@/lib/sessions/manager', () => ({
  sessionManager: {
    getContext: vi.fn(async () => []),
    persistTurn: vi.fn(async () => {}),
  },
}));

const closeMcpMock = vi.fn(async () => {});
vi.mock('@/lib/mcp-out/bridge', () => ({
  loadMcpOutTools: vi.fn(async () => ({
    tools: {},
    toolMeta: {},
    connections: [],
    close: closeMcpMock,
  })),
}));

// @axiomhq/nextjs imports `next/server` without .js extension, which breaks
// vitest ESM resolution. Mock the whole module so tests run without Next.js.
vi.mock('@/lib/axiom/server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  withAxiom: (handler: unknown) => handler,
}));

vi.mock('@/lib/tools', () => ({
  registerLocusTools: vi.fn(),
}));

vi.mock('@/lib/agent/tool-bridge', () => ({
  buildToolSet: vi.fn(() => ({})),
}));

vi.mock('@/lib/agent/system-prompt', () => ({
  buildSystemPrompt: vi.fn(() => 'mock-system-prompt'),
}));

// Capture the runAgentTurn args and produce a fake StreamTextResult-ish
// object whose toUIMessageStreamResponse() returns a real Response.
const runAgentTurnMock = vi.fn();
vi.mock('@/lib/agent/run', () => ({
  DEFAULT_MODEL: 'claude-sonnet-4-6',
  runAgentTurn: (params: unknown) => runAgentTurnMock(params),
}));

vi.mock('@vercel/functions', () => ({
  // Run the promise eagerly in tests so we can assert recordUsage etc.
  waitUntil: (p: Promise<unknown>) => {
    void p;
  },
}));

// `convertToModelMessages` is real — exercise the v6 conversion path.
// (it lives inside `ai`, which we don't mock.)

import { POST } from '../route';

const TEST_AUTH = {
  userId: '00000000-0000-0000-0000-0000000000aa',
  companyId: '00000000-0000-0000-0000-0000000000bb',
  role: 'owner' as const,
  email: 'tester@example.com',
  fullName: 'Tester',
};

const TEST_BRAIN = {
  id: '00000000-0000-0000-0000-0000000000cc',
  name: 'Acme',
  slug: 'acme',
};

function buildBody(messages: unknown[], sessionId: string | null = 'sess-1') {
  return {
    messages,
    sessionId,
  };
}

function buildRequest(body: unknown, init?: RequestInit): Request {
  return new Request('http://test.local/api/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });
}

beforeEach(() => {
  requireAuthMock.mockReset();
  getBrainForCompanyMock.mockReset();
  dbSelectMock.mockReset();
  recordUsageMock.mockReset();
  flushEventsMock.mockReset();
  runAgentTurnMock.mockReset();
  closeMcpMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/agent/chat — auth', () => {
  it('returns 401 when requireAuth throws ApiAuthError(401)', async () => {
    const { ApiAuthError } = await import('@/lib/api/errors');
    requireAuthMock.mockRejectedValueOnce(
      new ApiAuthError(401, 'unauthenticated', 'Sign in required.'),
    );

    const res = await POST(buildRequest(buildBody([{ role: 'user' }])));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
  });

  it('returns 403 when authenticated user has no companyId', async () => {
    requireAuthMock.mockResolvedValueOnce({ ...TEST_AUTH, companyId: null });

    const res = await POST(buildRequest(buildBody([{ role: 'user' }])));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('no_company');
  });
});

describe('POST /api/agent/chat — happy path', () => {
  beforeEach(() => {
    requireAuthMock.mockResolvedValue(TEST_AUTH);
    getBrainForCompanyMock.mockResolvedValue(TEST_BRAIN);
    // Query order for sessionId='sess-1' requests:
    //   1. folders (thenable, no .limit())
    //   2. companies (.limit())
    //   3. sessions (.limit())
    //   4. skills fallback (thenable, no .limit()) — else branch when agentDefinitionId null
    // Persistent [] as default handles everything after the first three Once values.
    dbSelectMock.mockResolvedValueOnce([]); // folders
    dbSelectMock.mockResolvedValueOnce([{ name: 'Acme Co' }]); // companies
    dbSelectMock.mockResolvedValueOnce([{ agentDefinitionId: null }]); // sessions
    // Skills fallback + any remaining queries: return [] so agentSkillIds is
    // empty and the visibleSkills query is skipped.
    dbSelectMock.mockResolvedValue([]);
  });

  it('delegates to runAgentTurn and returns the UIMessageStreamResponse', async () => {
    const fakeResponse = new Response('ok', { status: 200 });
    const result = {
      toUIMessageStreamResponse: vi.fn(() => fakeResponse),
    };
    runAgentTurnMock.mockResolvedValueOnce({ result });

    const res = await POST(
      buildRequest(
        buildBody([
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }],
          },
        ]),
      ),
    );

    expect(res).toBe(fakeResponse);
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
    const params = runAgentTurnMock.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      ctx: expect.objectContaining({
        actor: expect.objectContaining({
          type: 'platform_agent',
          userId: TEST_AUTH.userId,
          companyId: TEST_AUTH.companyId,
          scopes: ['read'],
        }),
        brainId: TEST_BRAIN.id,
        companyId: TEST_AUTH.companyId,
        sessionId: 'sess-1',
      }),
      system: 'mock-system-prompt',
      maxSteps: 6,
    });
    expect(result.toUIMessageStreamResponse).toHaveBeenCalledTimes(1);
  });

  it('forwards request.signal as ctx.abortSignal to runAgentTurn', async () => {
    const result = {
      toUIMessageStreamResponse: vi.fn(() => new Response('ok')),
    };
    runAgentTurnMock.mockResolvedValueOnce({ result });

    const ac = new AbortController();
    const req = buildRequest(
      buildBody([
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'hello' }],
        },
      ]),
      { signal: ac.signal },
    );
    await POST(req);

    const params = runAgentTurnMock.mock.calls[0]?.[0];
    expect(params.ctx.abortSignal).toBe(req.signal);
  });

  it('invokes onFinish callback chain (recordUsage with cached input tokens propagated)', async () => {
    const result = {
      toUIMessageStreamResponse: vi.fn(() => new Response('ok')),
    };
    runAgentTurnMock.mockResolvedValueOnce({ result });

    await POST(
      buildRequest(
        buildBody([
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }],
          },
        ]),
      ),
    );

    // Pull the onFinish the route registered and invoke it with a
    // synthesised finish event. We only need the usage shape — the rest
    // of the StepResult interface is irrelevant to recordUsage.
    const params = runAgentTurnMock.mock.calls[0]?.[0];
    await params.onFinish({
      response: { messages: [] },
      toolCalls: [],
      usage: {
        inputTokens: 200,
        outputTokens: 50,
        totalTokens: 250,
        inputTokenDetails: { cacheReadTokens: 150 },
      },
    });

    // onFinish wraps in waitUntil; our test mock invokes the promise
    // immediately by virtue of `void p` running it. Allow microtasks to
    // settle before asserting.
    await new Promise((r) => setTimeout(r, 0));

    expect(recordUsageMock).toHaveBeenCalledTimes(1);
    expect(recordUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'anthropic/claude-sonnet-4-6',
        inputTokens: 200,
        outputTokens: 50,
        totalTokens: 250,
        cachedInputTokens: 150,
      }),
    );
  });
});

describe('POST /api/agent/chat — agentDefinitionId threading (Task 9)', () => {
  // Query order for requests with sessionId:
  //   1. folders (thenable, no .limit()) — always first
  //   2. companies (.limit())
  //   3. sessions (.limit())
  //   4+ capabilities / skills repos (.limit()) or skills fallback (thenable)
  // All queries share `dbSelectMock`; tests use `mockResolvedValueOnce`
  // in sequence to control each call's result.
  beforeEach(() => {
    requireAuthMock.mockResolvedValue(TEST_AUTH);
    getBrainForCompanyMock.mockResolvedValue(TEST_BRAIN);
  });

  it('threads the session row agent_definition_id onto AgentContext', async () => {
    dbSelectMock.mockResolvedValueOnce([]); // folders
    dbSelectMock.mockResolvedValueOnce([{ name: 'Acme Co' }]); // companies
    dbSelectMock.mockResolvedValueOnce([
      { agentDefinitionId: 'agent-def-123' },
    ]); // sessions
    // Task 11: capabilities lookup fires when the session has an agent
    // bound. An empty-content doc → empty frontmatter → `capabilities`
    // field absent → repo returns []. That keeps this test focused on
    // agentDefinitionId threading; capability derivation has its own unit.
    dbSelectMock.mockResolvedValueOnce([{ content: '' }]); // documents (capabilities)
    // Task 9 (skills): same-shape lookup for `getAgentSkillIds`. Empty
    // content → no `skills:` key → repo returns []; the route's later
    // visibleSkills query is short-circuited and never fires.
    dbSelectMock.mockResolvedValueOnce([{ content: '' }]); // documents (skills)

    const result = {
      toUIMessageStreamResponse: vi.fn(() => new Response('ok')),
    };
    runAgentTurnMock.mockResolvedValueOnce({ result });

    await POST(
      buildRequest(
        buildBody(
          [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'hi' }],
            },
          ],
          'sess-with-agent',
        ),
      ),
    );

    const params = runAgentTurnMock.mock.calls[0]?.[0];
    expect(params.ctx.agentDefinitionId).toBe('agent-def-123');
    expect(params.ctx.sessionId).toBe('sess-with-agent');
  });

  it('resolves agentDefinitionId to null when the session row has no agent bound', async () => {
    dbSelectMock.mockResolvedValueOnce([]); // folders
    dbSelectMock.mockResolvedValueOnce([{ name: 'Acme Co' }]); // companies
    // Column is nullable; Drizzle returns `null` when the value is NULL.
    dbSelectMock.mockResolvedValueOnce([{ agentDefinitionId: null }]); // sessions
    // Skills fallback (no agent-def): return [] so agentSkillIds is empty
    // and the visibleSkills query is skipped.
    dbSelectMock.mockResolvedValue([]);

    const result = {
      toUIMessageStreamResponse: vi.fn(() => new Response('ok')),
    };
    runAgentTurnMock.mockResolvedValueOnce({ result });

    await POST(
      buildRequest(
        buildBody(
          [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'hi' }],
            },
          ],
          'sess-no-agent',
        ),
      ),
    );

    const params = runAgentTurnMock.mock.calls[0]?.[0];
    expect(params.ctx.agentDefinitionId).toBeNull();
  });

  it('resolves agentDefinitionId to null when there is no sessionId (fresh chat)', async () => {
    // No session → no sessions query. Query order: folders, companies, skills fallback.
    dbSelectMock.mockResolvedValueOnce([]); // folders
    dbSelectMock.mockResolvedValueOnce([{ name: 'Acme Co' }]); // companies
    // Skills fallback (no agent-def, no session): return [] so agentSkillIds
    // is empty and the visibleSkills query is skipped.
    dbSelectMock.mockResolvedValue([]);

    const result = {
      toUIMessageStreamResponse: vi.fn(() => new Response('ok')),
    };
    runAgentTurnMock.mockResolvedValueOnce({ result });

    await POST(
      buildRequest(
        buildBody(
          [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'hi' }],
            },
          ],
          null,
        ),
      ),
    );

    const params = runAgentTurnMock.mock.calls[0]?.[0];
    expect(params.ctx.agentDefinitionId).toBeNull();
    expect(params.ctx.sessionId).toBeNull();
    // Three queries fired: folders (thenable) + companies (.limit()) +
    // skills fallback (thenable). The sessions lookup is gated on
    // `body.sessionId` being truthy, so a new chat (sessionId: null)
    // short-circuits past it.
    expect(dbSelectMock).toHaveBeenCalledTimes(3);
  });

  it('resolves agentDefinitionId to null when the session row is missing (cross-tenant id)', async () => {
    // The company+session WHERE clause yields zero rows — treat as
    // default Platform Agent rather than blowing up.
    dbSelectMock.mockResolvedValueOnce([]); // folders
    dbSelectMock.mockResolvedValueOnce([{ name: 'Acme Co' }]); // companies
    dbSelectMock.mockResolvedValueOnce([]); // sessions: no row
    // Skills fallback (no agent-def): return [] so agentSkillIds is empty.
    dbSelectMock.mockResolvedValue([]);

    const result = {
      toUIMessageStreamResponse: vi.fn(() => new Response('ok')),
    };
    runAgentTurnMock.mockResolvedValueOnce({ result });

    await POST(
      buildRequest(
        buildBody(
          [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'hi' }],
            },
          ],
          'not-my-session',
        ),
      ),
    );

    const params = runAgentTurnMock.mock.calls[0]?.[0];
    expect(params.ctx.agentDefinitionId).toBeNull();
  });

  it('fallback: exposes all company skills to Platform Agent when no agent-definition bound', async () => {
    // Arrange: company has two skills installed.
    const SKILL_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const SKILL_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    // Query order: folders, companies, sessions, skills-fallback, visibleSkills.
    dbSelectMock.mockResolvedValueOnce([]); // folders
    dbSelectMock.mockResolvedValueOnce([{ name: 'Acme Co' }]); // companies
    dbSelectMock.mockResolvedValueOnce([{ agentDefinitionId: null }]); // sessions
    // Skills fallback returns two skill rows.
    dbSelectMock.mockResolvedValueOnce([{ id: SKILL_ID_1 }, { id: SKILL_ID_2 }]);
    // visibleSkills query (agentSkillIds non-empty): return two skill docs.
    dbSelectMock.mockResolvedValue([
      {
        id: SKILL_ID_1,
        content: '---\nname: Skill One\ndescription: Does one thing\n---\nBody one',
      },
      {
        id: SKILL_ID_2,
        content: '---\nname: Skill Two\ndescription: Does two things\n---\nBody two',
      },
    ]);

    const result = {
      toUIMessageStreamResponse: vi.fn(() => new Response('ok')),
    };
    runAgentTurnMock.mockResolvedValueOnce({ result });

    await POST(
      buildRequest(
        buildBody(
          [{ id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
          'sess-no-agent-2',
        ),
      ),
    );

    // agentSkillIds should be populated from the fallback query.
    const params = runAgentTurnMock.mock.calls[0]?.[0];
    expect(params.ctx.agentDefinitionId).toBeNull();
    // 5 calls: folders, companies, sessions, skills-fallback, visibleSkills.
    expect(dbSelectMock).toHaveBeenCalledTimes(5);
  });
});

describe('POST /api/agent/chat — deny path', () => {
  beforeEach(() => {
    requireAuthMock.mockResolvedValue(TEST_AUTH);
    getBrainForCompanyMock.mockResolvedValue(TEST_BRAIN);
    // Query order: folders (thenable), companies (.limit()), sessions (.limit()),
    // skills fallback (thenable). Return [] for everything except companies.
    dbSelectMock.mockResolvedValueOnce([]); // folders
    dbSelectMock.mockResolvedValueOnce([{ name: 'Acme Co' }]); // companies
    dbSelectMock.mockResolvedValueOnce([{ agentDefinitionId: null }]); // sessions
    dbSelectMock.mockResolvedValue([]); // skills fallback + any remaining
  });

  it('returns a properly-terminated 200 UI message stream when runAgentTurn returns result=null (SessionStart denied)', async () => {
    // Simulate runAgentTurn's deny return shape: no StreamTextResult,
    // just the `denied` reason. Route should synthesise an empty UI
    // message stream response rather than crash with "null.toUIMessageStreamResponse()".
    runAgentTurnMock.mockResolvedValueOnce({
      result: null,
      events: (async function* () {
        // Minimal events generator — the route doesn't drain it.
      })(),
      denied: { reason: 'circuit_breaker_open' },
    });

    const res = await POST(
      buildRequest(
        buildBody([
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }],
          },
        ]),
      ),
    );

    expect(res.status).toBe(200);
    // Drain the body so we can assert the SSE stream terminated
    // without throwing.
    const text = await res.text();
    // The empty stream carries one text-delta with the denial reason;
    // the UI message SSE protocol prefixes `data:` frames.
    expect(text).toContain('circuit_breaker_open');
    expect(text).toContain('data:');
  });
});

describe('POST /api/agent/chat — MCP OUT teardown', () => {
  beforeEach(() => {
    requireAuthMock.mockResolvedValue(TEST_AUTH);
    getBrainForCompanyMock.mockResolvedValue(TEST_BRAIN);
    // Query order: folders (thenable), companies (.limit()), sessions (.limit()),
    // skills fallback (thenable). Return [] for everything except companies.
    dbSelectMock.mockResolvedValueOnce([]); // folders
    dbSelectMock.mockResolvedValueOnce([{ name: 'Acme Co' }]); // companies
    dbSelectMock.mockResolvedValueOnce([{ agentDefinitionId: null }]); // sessions
    dbSelectMock.mockResolvedValue([]); // skills fallback + any remaining
  });

  it('invokes MCP close() via waitUntil on the happy path', async () => {
    const result = {
      toUIMessageStreamResponse: vi.fn(() => new Response('ok')),
    };
    runAgentTurnMock.mockResolvedValueOnce({ result });

    await POST(
      buildRequest(
        buildBody([
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }],
          },
        ]),
      ),
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(closeMcpMock).toHaveBeenCalledTimes(1);
  });

  it('invokes MCP close() via waitUntil on the deny path', async () => {
    runAgentTurnMock.mockResolvedValueOnce({
      result: null,
      denied: { reason: 'circuit_breaker_open' },
    });

    await POST(
      buildRequest(
        buildBody([
          {
            id: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'hello' }],
          },
        ]),
      ),
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(closeMcpMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/agent/chat — single entry point invariant', () => {
  it("does not import 'streamText' from 'ai' (the harness is the only entry point)", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const routeSrc = fs.readFileSync(
      path.resolve(__dirname, '../route.ts'),
      'utf8',
    );
    // Strip line and block comments so the assertion isn't tripped by
    // documentation that happens to mention `streamText`.
    const stripped = routeSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\bstreamText\b/);
  });
});

// Phase 1 WebFetch Task 13 — end-to-end integration coverage for the
// Firecrawl-backed web_fetch tool.
//
// Three scenarios:
//   A. Happy path: Platform Agent (no agent-definition) → web_fetch tool call
//      → two usage_records rows (provider='firecrawl' + provider='anthropic'
//      with model='claude-haiku-4-5-20251001'), both with 30% markup math.
//   B. Capability filter: agent-definition with `capabilities: []` strips
//      web tools from the turn's toolset — neither Firecrawl nor the
//      extractor ever fires.
//   C. Kill-switch: FIRECRAWL_ENABLED=false short-circuits web_fetch with
//      a `disabled` error envelope; Firecrawl scrape is never invoked and
//      no `firecrawl` usage row lands.
//
// Strategy: mock `@mendable/firecrawl-js` so no real Firecrawl API call
// fires, mock the Haiku extractor so no real Anthropic call fires inside
// the tool, and mock the outer Platform Agent LLM via the same
// `@ai-sdk/anthropic` hook used by mvp-platform-agent.test.ts. Everything
// else (session persistence, usage recording, capability derivation,
// tool-bridge filtering) runs against live Postgres.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';

import { db } from '@/db';
import { documents, sessions, usageRecords } from '@/db/schema';

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

// Mock the outer Anthropic provider — replaced per-test. Same pattern as
// mvp-platform-agent.test.ts.
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

// Mock Firecrawl SDK so no real HTTP call fires. Constructor returns an
// object with `.search` and `.scrape` — matches the surface the real
// `firecrawl-client.ts` consumes. Mocks are wrapped in `vi.hoisted` so
// they're initialised BEFORE the `vi.mock` factory runs (which is itself
// hoisted above all imports).
const { firecrawlSearchMock, firecrawlScrapeMock, extractMock } = vi.hoisted(
  () => ({
    firecrawlSearchMock: vi.fn(),
    firecrawlScrapeMock: vi.fn(),
    extractMock: vi.fn(),
  }),
);

vi.mock('@mendable/firecrawl-js', () => {
  function MockFirecrawl() {
    return { search: firecrawlSearchMock, scrape: firecrawlScrapeMock };
  }
  return { default: MockFirecrawl, Firecrawl: MockFirecrawl };
});

// Mock the Haiku extractor so no real `@ai-sdk/anthropic` invocation fires
// from inside web_fetch. Preserve HAIKU_MODEL_ID via importActual so the
// tool's usage-recording path still threads the canonical model id.
vi.mock('@/lib/webfetch/extractor', async () => {
  const actual = await vi.importActual<typeof import('@/lib/webfetch/extractor')>(
    '@/lib/webfetch/extractor',
  );
  return {
    ...actual,
    extract: extractMock,
  };
});

// Mock @vercel/functions waitUntil so onFinish persistence is observable
// synchronously in the test.
const waitUntilPromises: Array<Promise<unknown>> = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(Promise.resolve(p).catch(() => {}));
  },
}));

// Import route handlers AFTER mocks are installed.
import { POST as chatPOST } from '@/app/api/agent/chat/route';
import { POST as sessionsPOST } from '@/app/api/agent/sessions/route';
import { __resetFirecrawlClientForTests } from '@/lib/webfetch/firecrawl-client';

// --- Helpers ------------------------------------------------------------

async function flushWaitUntil(): Promise<void> {
  const pending = [...waitUntilPromises];
  waitUntilPromises.length = 0;
  await Promise.all(pending);
  await new Promise((r) => setTimeout(r, 0));
}

async function drainStream(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
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

// --- Seed ---------------------------------------------------------------

let company: TestCompany;

beforeAll(async () => {
  company = await createSeededCompany('webfetch-e2e');
  mockAuth.userId = company.userId;
  mockAuth.companyId = company.companyId;
}, 120_000);

afterAll(async () => {
  await cleanupCompany(company);
}, 120_000);

beforeEach(() => {
  mockProvider.reset();
  waitUntilPromises.length = 0;
  firecrawlSearchMock.mockReset();
  firecrawlScrapeMock.mockReset();
  extractMock.mockReset();
  // Reset the memoised Firecrawl client so each test re-enters
  // `new MockFirecrawl()` and picks up the fresh mock functions.
  __resetFirecrawlClientForTests();
  process.env.FIRECRAWL_API_KEY = 'fc-test';
  process.env.FIRECRAWL_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_ENABLED;
});

// --- Tests --------------------------------------------------------------

describe('WebFetch integration — Platform Agent end-to-end', () => {
  it(
    'happy path: web_fetch records two usage rows with 30% markup',
    async () => {
      // 1. Create a session.
      const sessRes = await sessionsPOST(
        buildSessionPostRequest({ firstMessage: 'summarise example.com' }),
      );
      expect(sessRes.status).toBe(201);
      const { data: sessionData } = (await sessRes.json()) as {
        data: { id: string };
      };
      const sessionId = sessionData.id;

      // 2. Wire the Firecrawl + extractor mocks.
      firecrawlScrapeMock.mockResolvedValue({
        markdown: '# Example\n\nbody',
        metadata: { title: 'Example', sourceURL: 'https://example.com' },
      });
      extractMock.mockResolvedValue({
        kind: 'ok',
        text: 'The page is about examples.',
        usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500 },
      });

      // 3. Mock the outer Platform Agent LLM: step 1 emits a tool-call for
      //    web_fetch; step 2 emits final text after the tool result.
      let callCount = 0;
      mockProvider.setModel(
        new MockLanguageModelV3({
          doStream: async () => {
            callCount += 1;
            if (callCount === 1) {
              return {
                stream: simulateReadableStream({
                  chunks: [
                    { type: 'stream-start', warnings: [] },
                    {
                      type: 'tool-call',
                      toolCallId: 'call-1',
                      toolName: 'web_fetch',
                      input: JSON.stringify({
                        url: 'https://example.com',
                        prompt: 'summarise the page',
                      }),
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
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 't1' },
                  {
                    type: 'text-delta',
                    id: 't1',
                    delta: 'The page is about examples.',
                  },
                  { type: 'text-end', id: 't1' },
                  {
                    type: 'finish',
                    usage: {
                      inputTokens: {
                        total: 800,
                        noCache: 800,
                        cacheRead: undefined,
                        cacheWrite: undefined,
                      },
                      outputTokens: {
                        total: 30,
                        text: 30,
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

      // 4. Fire the chat turn.
      const res = await chatPOST(
        buildChatRequest(
          [
            {
              id: 'u1',
              role: 'user',
              parts: [{ type: 'text', text: 'summarise example.com' }],
            },
          ],
          sessionId,
        ),
      );
      expect(res.status).toBe(200);
      await drainStream(res);
      await flushWaitUntil();

      // 5. Firecrawl scrape was called with the requested URL.
      expect(firecrawlScrapeMock).toHaveBeenCalledWith(
        'https://example.com',
        expect.any(Object),
      );
      expect(extractMock).toHaveBeenCalled();

      // 6. Two relevant usage rows were written for this session —
      //    firecrawl + anthropic/haiku. (The Platform Agent's main-turn
      //    recordUsage row also lands, with model='claude-sonnet-4-6' or
      //    similar; ignored for this assertion.)
      const rows = await db
        .select()
        .from(usageRecords)
        .where(eq(usageRecords.sessionId, sessionId));

      const firecrawlRow = rows.find((r) => r.provider === 'firecrawl');
      const anthropicHaikuRow = rows.find(
        (r) =>
          r.provider === 'anthropic' &&
          r.model === 'claude-haiku-4-5-20251001',
      );
      expect(firecrawlRow).toBeDefined();
      expect(anthropicHaikuRow).toBeDefined();

      // Firecrawl free tier → provider cost 0; 0 * 1.3 = 0.
      expect(firecrawlRow!.providerCostUsd).toBe(0);
      expect(firecrawlRow!.customerCostUsd).toBe(0);

      // Haiku: 400 input + 100 output → 0.001*0.4 + 0.005*0.1 = 0.0009
      // provider, *1.3 = 0.00117 customer.
      expect(anthropicHaikuRow!.providerCostUsd).toBeCloseTo(0.0009, 6);
      expect(anthropicHaikuRow!.customerCostUsd).toBeCloseTo(
        0.0009 * 1.3,
        6,
      );
      expect(anthropicHaikuRow!.inputTokens).toBe(400);
      expect(anthropicHaikuRow!.outputTokens).toBe(100);
    },
    180_000,
  );

  it(
    'agent-definition without web capability excludes web tools from the turn',
    async () => {
      // 1. Create an agent-definition doc with capabilities: [].
      const agentDefId = randomUUID();
      const agentFrontmatter = yaml.dump({
        type: 'agent-definition',
        title: 'No-Web Agent',
        slug: 'no-web',
        model: 'claude-sonnet-4-6',
        tool_allowlist: null,
        baseline_docs: [],
        skills: [],
        system_prompt_snippet: '',
        capabilities: [],
      });
      const agentSlug = `no-web-${Date.now()}`;
      await db.insert(documents).values({
        id: agentDefId,
        companyId: company.companyId,
        brainId: company.brainId,
        title: 'No-Web Agent',
        type: 'agent-definition',
        content: `---\n${agentFrontmatter}---\n`,
        slug: agentSlug,
        path: `agent-definitions/${agentSlug}`,
        status: 'active',
      });

      // 2. Create a session bound to that agent-definition.
      const sessId = randomUUID();
      await db.insert(sessions).values({
        id: sessId,
        companyId: company.companyId,
        brainId: company.brainId,
        userId: company.userId,
        agentDefinitionId: agentDefId,
        firstMessage: 'fetch example.com',
      });

      // 3. Mock the LLM: simple text-only response, no tool calls.
      mockProvider.setModel(
        new MockLanguageModelV3({
          doStream: async () => ({
            stream: simulateReadableStream({
              chunks: [
                { type: 'stream-start', warnings: [] },
                { type: 'text-start', id: 't1' },
                {
                  type: 'text-delta',
                  id: 't1',
                  delta: 'I cannot browse the web.',
                },
                { type: 'text-end', id: 't1' },
                {
                  type: 'finish',
                  usage: {
                    inputTokens: {
                      total: 100,
                      noCache: 100,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                    outputTokens: {
                      total: 10,
                      text: 10,
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

      // 4. Fire the chat turn.
      const res = await chatPOST(
        buildChatRequest(
          [
            {
              id: 'u1',
              role: 'user',
              parts: [{ type: 'text', text: 'fetch example.com' }],
            },
          ],
          sessId,
        ),
      );
      expect(res.status).toBe(200);
      await drainStream(res);
      await flushWaitUntil();

      // 5. Capability filter stripped web tools — Firecrawl + extractor
      //    were never invoked (positive signal: the tools simply aren't
      //    in the toolset the model received).
      expect(firecrawlScrapeMock).not.toHaveBeenCalled();
      expect(firecrawlSearchMock).not.toHaveBeenCalled();
      expect(extractMock).not.toHaveBeenCalled();

      // 6. No firecrawl usage rows for this session.
      const firecrawlRows = await db
        .select()
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.sessionId, sessId),
            eq(usageRecords.provider, 'firecrawl'),
          ),
        );
      expect(firecrawlRows).toHaveLength(0);
    },
    180_000,
  );

  it(
    'FIRECRAWL_ENABLED=false short-circuits web_fetch with disabled error',
    async () => {
      process.env.FIRECRAWL_ENABLED = 'false';

      const sessRes = await sessionsPOST(
        buildSessionPostRequest({ firstMessage: 'fetch' }),
      );
      expect(sessRes.status).toBe(201);
      const { data: sessionData } = (await sessRes.json()) as {
        data: { id: string };
      };
      const sessionId = sessionData.id;

      // LLM emits a web_fetch tool call (step 1); tool returns the
      // `disabled` error envelope to the model; step 2 emits text.
      let callCount = 0;
      mockProvider.setModel(
        new MockLanguageModelV3({
          doStream: async () => {
            callCount += 1;
            if (callCount === 1) {
              return {
                stream: simulateReadableStream({
                  chunks: [
                    { type: 'stream-start', warnings: [] },
                    {
                      type: 'tool-call',
                      toolCallId: 'c1',
                      toolName: 'web_fetch',
                      input: JSON.stringify({
                        url: 'https://example.com',
                        prompt: 'summarise this',
                      }),
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
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 't1' },
                  {
                    type: 'text-delta',
                    id: 't1',
                    delta: 'Web is disabled right now.',
                  },
                  { type: 'text-end', id: 't1' },
                  {
                    type: 'finish',
                    usage: {
                      inputTokens: {
                        total: 100,
                        noCache: 100,
                        cacheRead: undefined,
                        cacheWrite: undefined,
                      },
                      outputTokens: {
                        total: 10,
                        text: 10,
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

      const res = await chatPOST(
        buildChatRequest(
          [
            {
              id: 'u1',
              role: 'user',
              parts: [{ type: 'text', text: 'fetch' }],
            },
          ],
          sessionId,
        ),
      );
      expect(res.status).toBe(200);
      await drainStream(res);
      await flushWaitUntil();

      // Firecrawl + extractor both never called — the kill-switch
      // short-circuits before any network / LLM work.
      expect(firecrawlScrapeMock).not.toHaveBeenCalled();
      expect(extractMock).not.toHaveBeenCalled();

      // No firecrawl usage row landed for this session.
      const firecrawlRows = await db
        .select()
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.sessionId, sessionId),
            eq(usageRecords.provider, 'firecrawl'),
          ),
        );
      expect(firecrawlRows).toHaveLength(0);
    },
    180_000,
  );
});

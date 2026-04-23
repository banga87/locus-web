/**
 * @vitest-environment node
 */
// Workflow coordinator → subagent dispatch — end-to-end test.
//
// Proves the full coordinator model introduced in the workflow-coordinator
// plan (Task 5):
//
//   1. runWorkflow drives the workflow body under the platform agent
//      (DEFAULT_MODEL / claude-sonnet-4-6 via Anthropic provider).
//   2. The platform agent has the `Agent` dispatch tool available.
//   3. When the platform agent calls the Agent tool with subagent_type
//      'data-fetcher', runSubagent runs the user-defined subagent under
//      its own model (claude-haiku-4-5-20251001 → anthropic/claude-haiku-4.5
//      via the Gateway).
//   4. The subagent's output ("Top 3 issues: A, B, C.") is returned to the
//      platform agent as a tool-result and appears in the coordinator's next
//      LLM turn.
//   5. The platform agent then calls create_document at product/standup-summary.
//   6. workflow_runs.status lands on 'completed'.
//   7. workflow_runs.output_document_ids contains the created document's id.
//
// Mock strategy:
//   - `@ai-sdk/anthropic` is mocked globally (top-level vi.mock) so every
//     anthropic(modelId) call returns a model from mockAnthropicProvider.
//   - `@ai-sdk/gateway` is mocked globally so every gateway(modelId) call
//     (hit by runSubagent → resolveModel → getModel) returns a model from
//     mockGatewayProvider.
//   - Each provider tracks a per-modelId call counter and returns prepared
//     stream sequences. The Anthropic mock drives platform-agent turns A and
//     C; the Gateway mock drives subagent turn B.
//
// DB setup: seeds a real company/user/brain/folders/documents row per test
// run so the runner can execute real tool calls (create_document) and write
// provenance metadata.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Module mocks — must be at top before any import that transitively loads them.
// ---------------------------------------------------------------------------

// Track recorded model calls so tests can assert on modelIds.
const anthropicCallLog: string[] = [];
const gatewayCallLog: string[] = [];

// Platform agent uses `anthropic(modelId)` from @ai-sdk/anthropic.
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((modelId: string) => {
    anthropicCallLog.push(modelId);
    return mockAnthropicProvider.currentModel(modelId);
  }),
}));

// Subagent uses `gateway(modelId)` from @ai-sdk/gateway (via resolveModel →
// getModel).
vi.mock('@ai-sdk/gateway', () => ({
  gateway: vi.fn((modelId: string) => {
    gatewayCallLog.push(modelId);
    return mockGatewayProvider.currentModel(modelId);
  }),
}));

// Keep the audit logger silent.
vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

// Skip manifest regeneration — no manifest table rows seeded.
vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: vi.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// Provider abstractions (mirrors the pattern in run.test.ts)
// ---------------------------------------------------------------------------

function makeProvider(name: string) {
  return {
    current: null as LanguageModelV3 | null,
    currentModel(modelId: string): LanguageModelV3 {
      if (!this.current) {
        throw new Error(
          `${name} provider: current model not set (asked for ${modelId})`,
        );
      }
      return this.current;
    },
    setModel(m: LanguageModelV3) {
      this.current = m;
    },
    reset() {
      this.current = null;
    },
  };
}

const mockAnthropicProvider = makeProvider('anthropic');
const mockGatewayProvider = makeProvider('gateway');

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------

/** Standard finish chunk with token counts. */
function makeFinish(
  finishReason: 'stop' | 'tool-calls' | 'end_turn',
  inputTokens = 100,
  outputTokens = 50,
): LanguageModelV3StreamPart {
  const unified = finishReason === 'tool-calls' ? 'tool-calls' : 'stop';
  const raw = finishReason === 'tool-calls' ? 'tool_use' : 'end_turn';
  return {
    type: 'finish',
    usage: {
      inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: undefined },
      outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
    },
    finishReason: { unified, raw },
  };
}

function makeStream(chunks: LanguageModelV3StreamPart[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [{ type: 'stream-start', warnings: [] }, ...chunks],
      }),
    }),
  });
}

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { workflowRunEvents } from '@/db/schema/workflow-run-events';
import { usageRecords } from '@/db/schema/usage-records';

import { registerLocusTools, __resetLocusToolsRegistered } from '@/lib/tools';
import { __resetRegistryForTests } from '@/lib/tools/executor';
import {
  __resetContextHandlersForTests,
  registerContextHandlers,
} from '@/lib/context/register';
import { clearHooks } from '@/lib/agent/hooks';

import * as agentRunModule from '@/lib/agent/run';
import { DEFAULT_MODEL } from '@/lib/agent/run';

import { runWorkflow } from '@/lib/workflow/run';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface CoordFixtures {
  companyId: string;
  brainId: string;
  wfFolderId: string;
  productFolderId: string;
  /** Slug of the product folder (output_category value). */
  productFolderSlug: string;
  userId: string;
  workflowDocId: string;
}

const suffix = `coord-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function setupFixtures(): Promise<CoordFixtures> {
  const [company] = await db
    .insert(companies)
    .values({ name: `Coord Co ${suffix}`, slug: `coord-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({
      companyId: company!.id,
      name: 'Coord Brain',
      slug: `coord-brain-${suffix}`,
    })
    .returning({ id: brains.id });

  // Folder that holds the workflow document.
  const [wfFolder] = await db
    .insert(folders)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      slug: `workflows-${suffix}`,
      name: 'Workflows',
    })
    .returning({ id: folders.id });

  // Folder that the workflow will write its output document into.
  const productFolderSlug = `product-${suffix}`;
  const [productFolder] = await db
    .insert(folders)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      slug: productFolderSlug,
      name: 'Product',
    })
    .returning({ id: folders.id });

  // Triggering user (editor role required to call write tools).
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    companyId: company!.id,
    fullName: 'Coord User',
    email: `coord-${suffix}@example.test`,
    role: 'editor',
    status: 'active',
  });

  // User-defined agent-definition doc (data-fetcher subagent).
  // The frontmatter model is the fully-qualified ApprovedModelId accepted
  // directly by isApprovedModelId() in userDefinedAgents.resolveModel().
  await db.insert(documents).values({
    companyId: company!.id,
    brainId: brain!.id,
    title: 'Data Fetcher',
    slug: 'data-fetcher',
    path: `coord-brain-${suffix}/data-fetcher`,
    content: [
      '---',
      'name: "Data Fetcher"',
      'description: "Fetches lists of issues and returns compact summaries."',
      'model: "anthropic/claude-haiku-4.5"',
      '---',
      '',
      'You are the Data Fetcher subagent. Return concise summaries of lists.',
    ].join('\n'),
    type: 'agent-definition',
    version: 1,
    metadata: {},
  });

  // Workflow document — coordinator workflow that delegates to data-fetcher.
  const [wfDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: wfFolder!.id,
      title: 'Standup Workflow',
      slug: `standup-workflow-${suffix}`,
      path: `workflows-${suffix}/standup-workflow-${suffix}`,
      content: [
        '---',
        'type: workflow',
        'output: document',
        `output_category: ${productFolderSlug}`,
        'requires_mcps: []',
        'schedule: null',
        '---',
        '',
        'Dispatch to the data-fetcher subagent to pull the issue list, then create a summary document at product/standup-summary.',
      ].join('\n'),
      type: 'workflow',
      version: 1,
      metadata: {
        type: 'workflow',
        output: 'document',
        output_category: productFolderSlug,
        requires_mcps: [],
        schedule: null,
      },
    })
    .returning({ id: documents.id });

  return {
    companyId: company!.id,
    brainId: brain!.id,
    wfFolderId: wfFolder!.id,
    productFolderId: productFolder!.id,
    productFolderSlug,
    userId,
    workflowDocId: wfDoc!.id,
  };
}

async function teardownFixtures(f: CoordFixtures): Promise<void> {
  // FK order matters:
  //   workflow_runs → users, documents
  //   usage_records → companies (ON DELETE RESTRICT — must clear before company)
  //   brains CASCADE → documents + folders
  await db.delete(workflowRuns).where(eq(workflowRuns.workflowDocumentId, f.workflowDocId));
  await db.delete(users).where(eq(users.id, f.userId));
  // usage_records written by runSubagent reference the company — must delete
  // before the company row or the FK constraint fires.
  await db.delete(usageRecords).where(eq(usageRecords.companyId, f.companyId));
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, f.brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, f.companyId));
}

async function getRun(runId: string) {
  const [row] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, runId));
  return row ?? null;
}

async function getEvents(runId: string) {
  return db
    .select()
    .from(workflowRunEvents)
    .where(eq(workflowRunEvents.runId, runId))
    .orderBy(workflowRunEvents.sequence);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let fix: CoordFixtures;

beforeAll(async () => {
  fix = await setupFixtures();
  registerLocusTools();
}, 60_000);

afterAll(async () => {
  __resetRegistryForTests();
  __resetLocusToolsRegistered();
  await teardownFixtures(fix);
}, 60_000);

beforeEach(() => {
  mockAnthropicProvider.reset();
  mockGatewayProvider.reset();
  anthropicCallLog.length = 0;
  gatewayCallLog.length = 0;
  clearHooks();
  __resetContextHandlersForTests();
  // Re-register context handlers since we cleared them.
  registerContextHandlers();
});

afterEach(() => {
  mockAnthropicProvider.reset();
  mockGatewayProvider.reset();
  clearHooks();
});

// ---------------------------------------------------------------------------
// The e2e test
// ---------------------------------------------------------------------------

describe('Workflow coordinator — coordinator → subagent dispatch (Task 5)', () => {
  it(
    'platform agent dispatches to user-defined subagent, then writes the output document, run completes',
    { timeout: 30_000 },
    async () => {
      const outputDocSlug = `standup-summary-${suffix}`;
      const outputDocPath = `${fix.productFolderSlug}/${outputDocSlug}`;

      // -----------------------------------------------------------------------
      // Spy on runAgentTurn so we can assert that:
      //   - It is called with model: DEFAULT_MODEL (platform agent)
      //   - It has the Agent tool in its tool set
      // -----------------------------------------------------------------------
      const runAgentTurnSpy = vi.spyOn(agentRunModule, 'runAgentTurn');

      // -----------------------------------------------------------------------
      // Mock the Anthropic provider (platform agent, DEFAULT_MODEL = claude-sonnet-4.6).
      //
      // Three calls in sequence:
      //   Call 1 (turn A): emits Agent tool-call → data-fetcher
      //   Call 2 (turn C): emits create_document tool-call → standup-summary
      //   Call 3 (turn C continuation): emits plain text stop to end the loop
      // -----------------------------------------------------------------------
      let anthropicCallIdx = 0;

      mockAnthropicProvider.setModel(
        new MockLanguageModelV3({
          doStream: async () => {
            anthropicCallIdx++;

            if (anthropicCallIdx === 1) {
              // Turn A: platform agent calls the Agent dispatch tool.
              return {
                stream: simulateReadableStream({
                  chunks: [
                    { type: 'stream-start', warnings: [] },
                    {
                      type: 'tool-call',
                      toolCallId: 'call-agent-dispatch',
                      toolName: 'Agent',
                      input: JSON.stringify({
                        description: 'fetch issues',
                        subagent_type: 'data-fetcher',
                        prompt: 'List the open issues and summarise the top 3.',
                      }),
                    },
                    makeFinish('tool-calls', 80, 20),
                  ] satisfies LanguageModelV3StreamPart[],
                }),
              };
            }

            if (anthropicCallIdx === 2) {
              // Turn C: platform agent received the subagent result and creates
              // the output document. The path must match outputDocPath exactly.
              return {
                stream: simulateReadableStream({
                  chunks: [
                    { type: 'stream-start', warnings: [] },
                    {
                      type: 'tool-call',
                      toolCallId: 'call-create-doc',
                      toolName: 'create_document',
                      input: JSON.stringify({
                        path: outputDocPath,
                        title: 'Standup Summary',
                        body: 'Top 3 issues: A, B, C.',
                      }),
                    },
                    makeFinish('tool-calls', 120, 30),
                  ] satisfies LanguageModelV3StreamPart[],
                }),
              };
            }

            // Turn C continuation: agent confirms and stops.
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 'txt-done' },
                  {
                    type: 'text-delta',
                    id: 'txt-done',
                    delta: 'Summary document created successfully.',
                  },
                  { type: 'text-end', id: 'txt-done' },
                  makeFinish('stop', 60, 15),
                ] satisfies LanguageModelV3StreamPart[],
              }),
            };
          },
        }),
      );

      // -----------------------------------------------------------------------
      // Mock the Gateway provider (subagent, 'anthropic/claude-haiku-4.5').
      //
      // Call B: returns the subagent's summary text + stop.
      // -----------------------------------------------------------------------
      mockGatewayProvider.setModel(
        makeStream([
          { type: 'text-start', id: 'sub-txt' },
          {
            type: 'text-delta',
            id: 'sub-txt',
            delta: 'Top 3 issues: A, B, C.',
          },
          { type: 'text-end', id: 'sub-txt' },
          makeFinish('stop', 50, 25),
        ]),
      );

      // -----------------------------------------------------------------------
      // Seed and execute
      // -----------------------------------------------------------------------
      const [runRow] = await db
        .insert(workflowRuns)
        .values({
          workflowDocumentId: fix.workflowDocId,
          triggeredBy: fix.userId,
          status: 'running',
        })
        .returning({ id: workflowRuns.id });
      const runId = runRow!.id;

      await runWorkflow(runId);

      // -----------------------------------------------------------------------
      // Assertions
      // -----------------------------------------------------------------------

      // 1. Run status is 'completed'.
      const run = await getRun(runId);
      expect(run).not.toBeNull();
      expect(run!.status).toBe('completed');

      // 2. runAgentTurn was called with model: DEFAULT_MODEL (platform agent).
      //    The first call is always the platform agent coordinator turn.
      expect(runAgentTurnSpy).toHaveBeenCalled();
      const firstCallArgs = runAgentTurnSpy.mock.calls[0]![0];
      expect(firstCallArgs.model).toBe(DEFAULT_MODEL);

      // 3. The Agent dispatch tool was present in the platform agent's tool set.
      expect(firstCallArgs.tools).toHaveProperty('Agent');

      // 4. The event stream contains at least one tool_start for 'Agent'.
      const events = await getEvents(runId);
      const agentDispatchEvent = events.find(
        (e) =>
          e.eventType === 'tool_start' &&
          (e.payload as Record<string, unknown>).toolName === 'Agent',
      );
      expect(agentDispatchEvent).toBeDefined();

      // 5. The event stream contains at least one tool_start for 'create_document'.
      const createDocEvent = events.find(
        (e) =>
          e.eventType === 'tool_start' &&
          (e.payload as Record<string, unknown>).toolName === 'create_document',
      );
      expect(createDocEvent).toBeDefined();

      // 6. The output document exists at the expected path with the correct body.
      const [outputDoc] = await db
        .select()
        .from(documents)
        .where(eq(documents.path, outputDocPath));

      expect(outputDoc).toBeDefined();
      expect(outputDoc!.title).toBe('Standup Summary');
      expect(outputDoc!.content).toContain('Top 3 issues');
      expect(outputDoc!.brainId).toBe(fix.brainId);

      // 7. output_document_ids contains the created document's id.
      expect(run!.outputDocumentIds).toContain(outputDoc!.id);

      // 8. The subagent ran under a different model from the platform agent.
      //    Gateway was called with 'anthropic/claude-haiku-4.5' (user-defined
      //    model from the data-fetcher agent-definition doc).
      expect(gatewayCallLog).toContain('anthropic/claude-haiku-4.5');

      // 9. The platform agent ran under DEFAULT_MODEL via Anthropic.
      expect(anthropicCallLog).toContain(DEFAULT_MODEL);

      // 10. Last event is run_complete.
      expect(events.at(-1)!.eventType).toBe('run_complete');

      // 11. No run_error events.
      const errorEvent = events.find((e) => e.eventType === 'run_error');
      expect(errorEvent).toBeUndefined();

      // Restore the spy.
      runAgentTurnSpy.mockRestore();
    },
  );
});

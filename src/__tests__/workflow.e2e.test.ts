/**
 * @vitest-environment node
 */
// Workflow Phase 1.5 — end-to-end integration test.
//
// Proves the full stack: seed → trigger → runWorkflow → DB assertions.
//
// Strategy:
//   1. Seed a user, brain, folders, and a type:workflow document (with
//      metadata field populated — mirrors how the editor saves workflow docs).
//   2. Stub the LLM to emit one create_document tool call followed by
//      completion — this exercises the stamp middleware and output tracking.
//   3. Call runWorkflow(runId) directly (same path the trigger route uses
//      via waitUntil), bypassing HTTP so we don't need a running dev server.
//   4. Poll workflow_runs.status until terminal (max 10s, 200ms interval).
//   5. Assert all spec acceptance criteria.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Module mocks — must be installed BEFORE importing any module that
// transitively imports them, so they sit at the top.
// ---------------------------------------------------------------------------

// Stub the Anthropic provider so runWorkflow never makes real LLM calls.
// Each test sets mockProvider.current to a fresh MockLanguageModelV3.
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((modelId: string) => mockProvider.currentModel(modelId)),
}));

// Keep the audit logger silent — we're not testing it here.
vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

// Skip manifest regeneration — it requires additional DB rows we don't seed.
vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: vi.fn(async () => {}),
}));

// Stub the skill-manifest rebuild scheduler (it calls setTimeout internally
// and can cause test teardown issues).
vi.mock('@/lib/brain/save', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/brain/save')>();
  return { ...original, maybeScheduleSkillManifestRebuild: vi.fn() };
});

import type { LanguageModelV3 } from '@ai-sdk/provider';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { workflowRunEvents } from '@/db/schema/workflow-run-events';

import { registerLocusTools, __resetLocusToolsRegistered } from '@/lib/tools';
import { __resetRegistryForTests } from '@/lib/tools/executor';

import { runWorkflow } from '@/lib/workflow/run';

// ---------------------------------------------------------------------------
// Mock provider (same pattern as run.test.ts)
// ---------------------------------------------------------------------------

const mockProvider = {
  current: null as LanguageModelV3 | null,
  currentModel(modelId: string): LanguageModelV3 {
    if (!this.current) {
      throw new Error(`mockProvider.current not set (asked for ${modelId})`);
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

// Finish chunk reused by every mock stream.
const FINISH: LanguageModelV3StreamPart = {
  type: 'finish',
  usage: {
    inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: undefined },
    outputTokens: { total: 50, text: 50, reasoning: undefined },
  },
  finishReason: { unified: 'stop', raw: 'end_turn' },
};

const TOOL_CALL_FINISH: LanguageModelV3StreamPart = {
  type: 'finish',
  usage: {
    inputTokens: { total: 80, noCache: 60, cacheRead: 20, cacheWrite: undefined },
    outputTokens: { total: 40, text: 0, reasoning: undefined },
  },
  finishReason: { unified: 'tool-calls', raw: 'tool_use' },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface E2EFixtures {
  companyId: string;
  brainId: string;
  /** Folder the workflow document lives in. */
  wfFolderId: string;
  /** Folder the workflow will write its output document into. */
  outputFolderId: string;
  userId: string;
  workflowDocId: string;
  /** Slug of the output folder (used to build the tool-call path). */
  outputFolderSlug: string;
}

const suffix = `e2e-wf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function setupFixtures(): Promise<E2EFixtures> {
  const [company] = await db
    .insert(companies)
    .values({ name: `E2E Co ${suffix}`, slug: `e2e-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company!.id, name: 'E2E Brain', slug: `e2e-brain-${suffix}` })
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

  // Folder that the workflow will create its output document inside.
  // The output slug must be slug-safe and unique across the test run.
  const outputFolderSlug = `output-${suffix}`;
  const [outputFolder] = await db
    .insert(folders)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      slug: outputFolderSlug,
      name: 'Output',
    })
    .returning({ id: folders.id });

  // Seed the triggering user as 'editor' — viewers are rejected at the
  // trigger route gate and can't call write tools inside the runner.
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    companyId: company!.id,
    fullName: 'E2E User',
    email: `e2e-${suffix}@example.test`,
    role: 'editor',
    status: 'active',
  });

  // Seed the workflow document with both `content` (raw markdown with
  // frontmatter) and `metadata` (structured frontmatter — the trigger
  // route and runWorkflow both read from metadata). This mirrors how the
  // editor saves workflow docs (Task 7 POST syncs frontmatter → metadata).
  const [wfDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: wfFolder!.id,
      title: 'Test Workflow',
      slug: `test-workflow-${suffix}`,
      path: `workflows-${suffix}/test-workflow-${suffix}`,
      content: [
        '---',
        'type: workflow',
        'output: document',
        `output_category: ${outputFolderSlug}`,
        'requires_mcps: []',
        'schedule: null',
        '---',
        '',
        "Create a document titled 'Test Output' with body 'hello'.",
      ].join('\n'),
      type: 'workflow',
      version: 1,
      metadata: {
        type: 'workflow',
        output: 'document',
        output_category: outputFolderSlug,
        requires_mcps: [],
        schedule: null,
      },
    })
    .returning({ id: documents.id });

  return {
    companyId: company!.id,
    brainId: brain!.id,
    wfFolderId: wfFolder!.id,
    outputFolderId: outputFolder!.id,
    outputFolderSlug,
    userId,
    workflowDocId: wfDoc!.id,
  };
}

async function teardownFixtures(f: E2EFixtures): Promise<void> {
  // Delete workflow_runs first (FK constraint to documents + users).
  await db.delete(workflowRuns).where(eq(workflowRuns.workflowDocumentId, f.workflowDocId));
  // Delete the users row.
  await db.delete(users).where(eq(users.id, f.userId));
  // Brains ON DELETE CASCADE covers documents + folders. The
  // document_versions immutability trigger blocks deletes, so we disable
  // it for the duration of this transaction (same pattern as run.test.ts).
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

// ---------------------------------------------------------------------------
// DB read helpers
// ---------------------------------------------------------------------------

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

/**
 * Poll workflow_runs.status until it reaches a terminal state or the
 * timeout elapses. Returns the final status.
 */
async function pollUntilTerminal(
  runId: string,
  timeoutMs = 10_000,
  intervalMs = 200,
): Promise<string | null> {
  const terminal = new Set(['completed', 'failed', 'cancelled']);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await getRun(runId);
    if (run && terminal.has(run.status)) return run.status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Return whatever we have after timeout.
  const run = await getRun(runId);
  return run?.status ?? null;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let fix: E2EFixtures;

beforeAll(async () => {
  fix = await setupFixtures();
  registerLocusTools();
}, 60_000);

afterAll(async () => {
  __resetRegistryForTests();
  __resetLocusToolsRegistered();
  await teardownFixtures(fix);
}, 60_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Workflow Phase 1.5 — E2E integration', () => {
  it(
    'executes a create_document tool call, stamps provenance, tracks output doc, emits expected events',
    { timeout: 30_000 },
    async () => {
      // ---- Build the doc path the LLM will "decide" to create. -----
      // Must be {outputFolderSlug}/{docSlug} and both must be slug-safe.
      const outputDocSlug = `test-output-${suffix}`;
      const outputDocPath = `${fix.outputFolderSlug}/${outputDocSlug}`;

      // ---- LLM stub: two turns. --------------------------------
      // Turn 1: emits a create_document tool call (finishReason='tool-calls').
      // Turn 2: emits plain text + stop — the agent loop exits.
      let callIdx = 0;
      mockProvider.setModel(
        new MockLanguageModelV3({
          doStream: async () => {
            callIdx++;

            if (callIdx === 1) {
              // First turn: one tool call
              return {
                stream: simulateReadableStream({
                  chunks: [
                    { type: 'stream-start', warnings: [] },
                    {
                      type: 'tool-call',
                      toolCallId: 'call-e2e-create',
                      toolName: 'create_document',
                      input: JSON.stringify({
                        path: outputDocPath,
                        title: 'Test Output',
                        body: 'hello',
                      }),
                    },
                    TOOL_CALL_FINISH,
                  ] satisfies LanguageModelV3StreamPart[],
                }),
              };
            }

            // Second turn (continuation after tool result): plain text stop.
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 'txt-2' },
                  { type: 'text-delta', id: 'txt-2', delta: 'Document created.' },
                  { type: 'text-end', id: 'txt-2' },
                  FINISH,
                ] satisfies LanguageModelV3StreamPart[],
              }),
            };
          },
        }),
      );

      // ---- Seed a workflow_run row (status='running', as the route does). --
      const [runRow] = await db
        .insert(workflowRuns)
        .values({
          workflowDocumentId: fix.workflowDocId,
          triggeredBy: fix.userId,
          status: 'running',
        })
        .returning({ id: workflowRuns.id });
      const runId = runRow!.id;

      // ---- Execute -------------------------------------------------------
      await runWorkflow(runId);

      // ---- Poll until terminal (should be immediate, but be safe). -------
      const finalStatus = await pollUntilTerminal(runId, 10_000);

      // ---- Assertions ----------------------------------------------------

      // 1. Run completed successfully.
      expect(finalStatus).toBe('completed');

      const run = await getRun(runId);
      expect(run).not.toBeNull();
      expect(run!.status).toBe('completed');
      expect(run!.totalInputTokens).toBeGreaterThan(0);
      expect(run!.totalOutputTokens).toBeGreaterThan(0);

      // 2. The output document was created with the expected title.
      const [outputDoc] = await db
        .select()
        .from(documents)
        .where(eq(documents.path, outputDocPath));

      expect(outputDoc).toBeDefined();
      expect(outputDoc!.title).toBe('Test Output');
      expect(outputDoc!.brainId).toBe(fix.brainId);

      // 3. The output document has workflow provenance stamps in metadata.
      const meta = outputDoc!.metadata as Record<string, unknown>;
      expect(meta.created_by_workflow).toBeTruthy();
      expect(meta.created_by_workflow_run_id).toBe(runId);

      // 4. workflow_runs.output_document_ids contains the new doc's id.
      expect(run!.outputDocumentIds).toContain(outputDoc!.id);

      // 5. Events include the expected sequence.
      const events = await getEvents(runId);
      const eventTypes = events.map((e) => e.eventType);

      // Must have: turn_start (at least once)
      expect(eventTypes).toContain('turn_start');

      // Must have: tool_start and tool_result for create_document
      const toolStart = events.find(
        (e) =>
          e.eventType === 'tool_start' &&
          (e.payload as Record<string, unknown>).toolName === 'create_document',
      );
      expect(toolStart).toBeDefined();

      const toolResult = events.find(
        (e) =>
          e.eventType === 'tool_result' &&
          (e.payload as Record<string, unknown>).toolName === 'create_document',
      );
      expect(toolResult).toBeDefined();

      // turn_complete must appear at least once
      expect(eventTypes).toContain('turn_complete');

      // run_complete must be the last event
      expect(events.at(-1)!.eventType).toBe('run_complete');

      // No run_error events — this is the happy path.
      expect(eventTypes).not.toContain('run_error');

      // Events are in ascending sequence order.
      for (let i = 1; i < events.length; i++) {
        expect(events[i]!.sequence).toBeGreaterThan(events[i - 1]!.sequence);
      }
    },
  );
});

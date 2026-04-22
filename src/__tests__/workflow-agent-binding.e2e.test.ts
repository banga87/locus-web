/**
 * @vitest-environment node
 */
// Workflow agent-binding end-to-end integration test — Task 8.
//
// Proves that a workflow with `agent: <slug>` in its frontmatter runs
// under the resolved agent's config:
//   1. The SessionStart hook injects the persona snippet (system_prompt_snippet)
//      into the system prompt sent to the LLM.
//   2. Only the tools on the agent's tool_allowlist reach the LLM.
//   3. A workflow referencing a non-existent agent slug fails fast with
//      the correct error event and run status.
//
// Strategy mirrors `workflow.e2e.test.ts`:
//   - Module-level @ai-sdk/anthropic mock so runWorkflow never calls a
//     real LLM. MockLanguageModelV3.doStreamCalls captures the call
//     options (prompt + tools) so we can assert on both.
//   - Seed company, brain, folders, user, agent-scaffolding,
//     agent-definition, skill, and workflow docs via direct Drizzle inserts.
//   - Insert workflowRuns rows with status='running', call runWorkflow,
//     poll until terminal, assert.
//   - Tear down all seeded rows in afterAll (same trigger-disable pattern
//     as the sibling e2e test).
//
// Do NOT import or modify workflow.e2e.test.ts — this file is intentionally
// focused on agent-binding behaviour only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart, LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Module mocks — must be installed BEFORE importing any module that
// transitively imports them.
// ---------------------------------------------------------------------------

// Stub the Anthropic provider so runWorkflow never makes real LLM calls.
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

import { vi } from 'vitest';
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
import { clearHooks } from '@/lib/agent/hooks';
import {
  __resetContextHandlersForTests,
  registerContextHandlers,
} from '@/lib/context/register';
import { __clearScaffoldingCacheForTests } from '@/lib/context/repos';

import { runWorkflow } from '@/lib/workflow/run';

// ---------------------------------------------------------------------------
// Mock provider (same pattern as workflow.e2e.test.ts)
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface AgentBindingFixtures {
  companyId: string;
  brainId: string;
  folderId: string;
  userId: string;
  /** agent-scaffolding doc — required so buildScaffoldingPayload doesn't short-circuit. */
  scaffoldingDocId: string;
  /** agent-definition doc with slug='scoped'. */
  agentDefDocId: string;
  /** skill doc referenced by the agent-definition. */
  skillDocId: string;
  /** Workflow doc with agent: scoped (Test 1). */
  scopedWorkflowDocId: string;
  /** Workflow doc with agent: does-not-exist (Test 2). */
  missingAgentWorkflowDocId: string;
}

const suffix = `e2e-ab-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function setupFixtures(): Promise<AgentBindingFixtures> {
  const [company] = await db
    .insert(companies)
    .values({ name: `AB E2E Co ${suffix}`, slug: `ab-e2e-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({
      companyId: company!.id,
      name: 'AB E2E Brain',
      slug: `ab-brain-${suffix}`,
    })
    .returning({ id: brains.id });

  const [folder] = await db
    .insert(folders)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      slug: `ab-wf-${suffix}`,
      name: 'AB Workflows',
    })
    .returning({ id: folders.id });

  // Need an output folder for the workflow frontmatter's output_category.
  await db.insert(folders).values({
    companyId: company!.id,
    brainId: brain!.id,
    slug: `ab-output-${suffix}`,
    name: 'AB Output',
  });

  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    companyId: company!.id,
    fullName: 'AB E2E User',
    email: `ab-e2e-${suffix}@example.test`,
    role: 'editor',
    status: 'active',
  });

  // Agent-scaffolding doc — required so buildScaffoldingPayload doesn't
  // short-circuit on the missing-scaffolding path and actually reaches the
  // agent-definition lookup that injects the persona snippet.
  const scaffoldingContent = [
    '---',
    'type: agent-scaffolding',
    `title: AB Test Scaffolding ${suffix}`,
    'version: 1',
    '---',
    '',
    'This is the test company scaffolding context.',
  ].join('\n');

  const [scaffoldingDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: `AB Test Scaffolding ${suffix}`,
      slug: `ab-scaffolding-${suffix}`,
      path: `ab-wf-${suffix}/ab-scaffolding-${suffix}`,
      content: scaffoldingContent,
      type: 'agent-scaffolding',
      version: 1,
    })
    .returning({ id: documents.id });

  // Skill doc — referenced by the agent-definition.
  const skillContent = [
    '---',
    'name: Test Skill',
    'description: A skill for testing.',
    '---',
    '',
    'This skill is for integration testing purposes only.',
  ].join('\n');

  const [skillDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: 'Test Skill',
      slug: `ab-skill-${suffix}`,
      path: `ab-wf-${suffix}/ab-skill-${suffix}`,
      content: skillContent,
      type: 'skill',
      version: 1,
    })
    .returning({ id: documents.id });

  const skillDocId = skillDoc!.id;

  // Agent-definition doc — slug='scoped', model='claude-sonnet-4-6',
  // tool_allowlist=['get_document'], baseline_docs=[], skills=[skillDocId],
  // system_prompt_snippet='You are the scoped agent, answer tersely.',
  // capabilities=[].
  // Keys must be snake_case as read by resolveAgentConfigBySlug + repos.ts.
  const agentDefFm: Record<string, unknown> = {
    type: 'agent-definition',
    title: 'Scoped Agent',
    slug: 'scoped',
    model: 'claude-sonnet-4-6',
    tool_allowlist: ['get_document'],
    baseline_docs: [],
    skills: [skillDocId],
    system_prompt_snippet: 'You are the scoped agent, answer tersely.',
    capabilities: [],
  };
  const agentDefContent = `---\n${yaml.dump(agentDefFm)}---\n`;

  const [agentDefDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: 'Scoped Agent',
      // slug must match the `agent: scoped` value in workflow frontmatter —
      // resolveAgentConfigBySlug queries by slug.
      slug: 'scoped',
      path: `ab-wf-${suffix}/scoped`,
      content: agentDefContent,
      type: 'agent-definition',
      version: 1,
    })
    .returning({ id: documents.id });

  // Workflow doc with agent: scoped — used by Test 1.
  const [scopedWfDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: 'Scoped Agent Workflow',
      slug: `ab-scoped-wf-${suffix}`,
      path: `ab-wf-${suffix}/ab-scoped-wf-${suffix}`,
      content: [
        '---',
        'type: workflow',
        'output: document',
        `output_category: ab-output-${suffix}`,
        'requires_mcps: []',
        'schedule: null',
        'agent: scoped',
        '---',
        '',
        'Execute the scoped agent workflow.',
      ].join('\n'),
      type: 'workflow',
      version: 1,
      metadata: {
        type: 'workflow',
        output: 'document',
        output_category: `ab-output-${suffix}`,
        requires_mcps: [],
        schedule: null,
        agent: 'scoped',
      },
    })
    .returning({ id: documents.id });

  // Workflow doc with agent: does-not-exist — used by Test 2.
  const [missingAgentWfDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: 'Missing Agent Workflow',
      slug: `ab-missing-wf-${suffix}`,
      path: `ab-wf-${suffix}/ab-missing-wf-${suffix}`,
      content: [
        '---',
        'type: workflow',
        'output: document',
        `output_category: ab-output-${suffix}`,
        'requires_mcps: []',
        'schedule: null',
        'agent: does-not-exist',
        '---',
        '',
        'This workflow references a non-existent agent.',
      ].join('\n'),
      type: 'workflow',
      version: 1,
      metadata: {
        type: 'workflow',
        output: 'document',
        output_category: `ab-output-${suffix}`,
        requires_mcps: [],
        schedule: null,
        agent: 'does-not-exist',
      },
    })
    .returning({ id: documents.id });

  return {
    companyId: company!.id,
    brainId: brain!.id,
    folderId: folder!.id,
    userId,
    scaffoldingDocId: scaffoldingDoc!.id,
    agentDefDocId: agentDefDoc!.id,
    skillDocId,
    scopedWorkflowDocId: scopedWfDoc!.id,
    missingAgentWorkflowDocId: missingAgentWfDoc!.id,
  };
}

async function teardownFixtures(f: AgentBindingFixtures): Promise<void> {
  // Delete workflow_runs first (FK constraint to documents + users).
  await db
    .delete(workflowRuns)
    .where(eq(workflowRuns.workflowDocumentId, f.scopedWorkflowDocId));
  await db
    .delete(workflowRuns)
    .where(eq(workflowRuns.workflowDocumentId, f.missingAgentWorkflowDocId));
  // Delete the user row.
  await db.delete(users).where(eq(users.id, f.userId));
  // Brains ON DELETE CASCADE covers documents + folders. The
  // document_versions immutability trigger blocks deletes, so disable it
  // for the duration of the transaction (same pattern as workflow.e2e.test.ts).
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

let fix: AgentBindingFixtures;

beforeAll(async () => {
  fix = await setupFixtures();
  registerLocusTools();
  // Wire context handlers so SessionStart injects persona snippets.
  registerContextHandlers();
}, 60_000);

afterAll(async () => {
  __resetRegistryForTests();
  __resetLocusToolsRegistered();
  clearHooks();
  __resetContextHandlersForTests();
  __clearScaffoldingCacheForTests();
  await teardownFixtures(fix);
}, 60_000);

// ---------------------------------------------------------------------------
// Test 1: scoped-agent run succeeds, persona injected, tools filtered
// ---------------------------------------------------------------------------

describe('Workflow agent-binding — Task 8 E2E', () => {
  it(
    'Test 1: scoped-agent run: persona snippet injected into system prompt, tool allowlist enforced',
    { timeout: 30_000 },
    async () => {
      // Clear the scaffolding cache to ensure our newly seeded doc is picked up.
      __clearScaffoldingCacheForTests();

      // Capture call options from the first LLM call so we can assert on
      // the system prompt and tools list. MockLanguageModelV3 stores all
      // call args in .doStreamCalls[] — we read index [0] after the run.
      let capturedCallOptions: LanguageModelV3CallOptions | null = null;

      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          // Capture the first call's options (system prompt + tools).
          if (!capturedCallOptions) {
            capturedCallOptions = options;
          }
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'stream-start', warnings: [] },
                { type: 'text-start', id: 'txt-1' },
                { type: 'text-delta', id: 'txt-1', delta: 'Scoped agent response.' },
                { type: 'text-end', id: 'txt-1' },
                FINISH,
              ] satisfies LanguageModelV3StreamPart[],
            }),
          };
        },
      });
      mockProvider.setModel(model);

      // Insert the workflow run with status='running'.
      const [runRow] = await db
        .insert(workflowRuns)
        .values({
          workflowDocumentId: fix.scopedWorkflowDocId,
          triggeredBy: fix.userId,
          status: 'running',
        })
        .returning({ id: workflowRuns.id });
      const runId = runRow!.id;

      await runWorkflow(runId);

      const finalStatus = await pollUntilTerminal(runId, 10_000);

      // ---- Assertions -------------------------------------------------------

      // 1. Run completed successfully.
      expect(finalStatus).toBe('completed');

      const run = await getRun(runId);
      expect(run).not.toBeNull();
      expect(run!.status).toBe('completed');
      expect(run!.totalInputTokens).toBeGreaterThan(0);

      // 2. System prompt contains the persona snippet from the agent-definition.
      //
      //    The SessionStart hook calls buildScaffoldingPayload which:
      //      a. Loads the agent-scaffolding doc (present → continues).
      //      b. Loads the agent-definition by id → reads system_prompt_snippet.
      //      c. Injects `## Agent: Scoped Agent\n\nYou are the scoped agent, answer tersely.`
      //         BEFORE the base system prompt in runAgentTurn.
      //
      //    The LLM mock receives the final system string via the `prompt`
      //    array, where the system message has role='system' and the content
      //    is the assembled system prompt.
      expect(capturedCallOptions).not.toBeNull();

      // Find the system-role message in the prompt array.
      const prompt = capturedCallOptions!.prompt;
      const systemMessage = prompt.find((msg) => msg.role === 'system');
      expect(systemMessage).toBeDefined();
      // Type guard: system messages have content: string.
      const systemContent =
        systemMessage && typeof (systemMessage as { content: unknown }).content === 'string'
          ? (systemMessage as { role: 'system'; content: string }).content
          : '';

      // The persona snippet text must appear in the injected system prompt.
      expect(systemContent).toContain('You are the scoped agent, answer tersely.');

      // 3. Tool allowlist: only 'get_document' must reach the LLM.
      //    The agent-definition has tool_allowlist: ['get_document'], so only
      //    that tool passes the filter in run.ts.
      const toolNames = (capturedCallOptions!.tools ?? []).map((t) => t.name);
      expect(toolNames).toContain('get_document');

      // Tools NOT on the allowlist must NOT be present.
      expect(toolNames).not.toContain('create_document');
      expect(toolNames).not.toContain('update_document');
      expect(toolNames).not.toContain('search_documents');

      // 4. Events: no run_error events (happy path).
      const events = await getEvents(runId);
      const eventTypes = events.map((e) => e.eventType);
      expect(eventTypes).not.toContain('run_error');
      expect(events.at(-1)!.eventType).toBe('run_complete');

      mockProvider.reset();
    },
  );

  // ---------------------------------------------------------------------------
  // Test 2: missing-agent run fails fast
  // ---------------------------------------------------------------------------

  it(
    'Test 2: missing-agent run: fails fast with agent_not_found event, no turn_start emitted',
    { timeout: 30_000 },
    async () => {
      // Do NOT install a mock model — runAgentTurn must never be reached.
      // If it were somehow reached, mockProvider.current is null and
      // currentModel() would throw, surfacing the bug immediately.
      mockProvider.reset();

      // Insert the workflow run for the missing-agent workflow doc.
      const [runRow] = await db
        .insert(workflowRuns)
        .values({
          workflowDocumentId: fix.missingAgentWorkflowDocId,
          triggeredBy: fix.userId,
          status: 'running',
        })
        .returning({ id: workflowRuns.id });
      const runId = runRow!.id;

      await runWorkflow(runId);

      const finalStatus = await pollUntilTerminal(runId, 10_000);

      // ---- Assertions -------------------------------------------------------

      // 1. Run must be failed.
      expect(finalStatus).toBe('failed');

      const run = await getRun(runId);
      expect(run).not.toBeNull();
      expect(run!.status).toBe('failed');

      // 2. errorMessage must contain the slug that was not found.
      expect(run!.errorMessage).toMatch(/Agent "does-not-exist" not found/);

      // 3. Exactly one run_error event with the expected payload.
      const events = await getEvents(runId);
      const errorEvents = events.filter((e) => e.eventType === 'run_error');
      expect(errorEvents).toHaveLength(1);

      const payload = errorEvents[0]!.payload as Record<string, unknown>;
      expect(payload.reason).toBe('agent_not_found');
      expect(payload.slug).toBe('does-not-exist');

      // 4. No turn_start event — runAgentTurn must have been short-circuited.
      const eventTypes = events.map((e) => e.eventType);
      expect(eventTypes).not.toContain('turn_start');
    },
  );
});

/**
 * @vitest-environment node
 */
// Integration test for Task 11 Step 1 — agent lifecycle.
//
// Covers the two GAPS not exercised by existing integration tests:
//   1. DELETE a referenced baseline doc → 409 with the referencing-
//      agents list. This asserts the new guard in
//      `src/app/api/brain/documents/[id]/route.ts::DELETE` (added
//      alongside this test — plan Task 11 Step 1 line 1890).
//   2. Archive a referenced baseline → a FRESH chat turn renders an
//      "archived" note in the injected system block. Task 5's
//      `scaffolding.integration.test.ts` covers the annotation at the
//      pure-function level; this test proves it reaches the actual
//      model prompt end-to-end via the chat route.
//
// What is NOT re-tested here (already covered):
//   - SessionStart scaffolding + persona + baseline in the system
//     prompt (Task 9 `route.integration.test.ts`).
//   - UserPromptSubmit skill matching (Task 9).
//   - Agent CRUD 409 on active-session delete (Task 4
//     `agents.test.ts`).
//   - Agent-definition frontmatter round-trip (Task 4
//     `agents.test.ts` + `definitions.test.ts`).
//
// Fixture pattern mirrors `src/app/api/agent/chat/__tests__/
// route.integration.test.ts` — live DB via the service-role DATABASE_
// URL, mocked Anthropic transport, mocked `requireAuth`, clear the
// hook bus before each test so we don't trip on stale registrations.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';

import { db } from '@/db';
import {
  auditEvents,
  brains,
  categories,
  companies,
  documents,
  sessions,
  skillManifests,
  usageRecords,
  users,
} from '@/db/schema';
import { buildAgentDefinitionDoc } from '@/lib/agents/definitions';
import { rebuildManifest } from '@/lib/skills/loader';
import { __clearScaffoldingCacheForTests } from '@/lib/context/repos';
import { __resetContextHandlersForTests } from '@/lib/context/register';
import { clearHooks } from '@/lib/agent/hooks';

// --- Module mocks -------------------------------------------------------

const mockAuth = {
  userId: '',
  companyId: '',
  role: 'owner' as const,
  email: 't11-lifecycle@local',
  fullName: 'Task 11 Lifecycle Tester',
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

// Mock Anthropic provider — same pattern as Task 9's test file.
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

const waitUntilPromises: Array<Promise<unknown>> = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(Promise.resolve(p).catch(() => {}));
  },
}));

// Import routes AFTER mocks are installed.
import { POST as chatPOST } from '@/app/api/agent/chat/route';
import { DELETE as brainDocDELETE } from '@/app/api/brain/documents/[id]/route';

// --- Fixture ------------------------------------------------------------

const suffix = `t11-lc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let categoryId: string;
let scaffoldingDocId: string;
let baselineDocId: string;
let agentDefinitionDocId: string;
let sessionId: string;

const SCAFFOLDING_MARKER = `${suffix}-scaffolding-marker`;
const BASELINE_MARKER = `${suffix}-baseline-marker`;
const BASELINE_TITLE = 'Brand Voice';

function scaffoldingContent(): string {
  return `---\ntype: agent-scaffolding\ntitle: How ${suffix} Works\nversion: 1\n---\n\n${SCAFFOLDING_MARKER}\n\nCompany context.`;
}

function baselineContent(): string {
  return `---\ntype: knowledge\ntitle: ${BASELINE_TITLE}\n---\n\n${BASELINE_MARKER}\n\nFriendly and direct.`;
}

beforeAll(async () => {
  clearHooks();
  __resetContextHandlersForTests();
  __clearScaffoldingCacheForTests();

  const [company] = await db
    .insert(companies)
    .values({ name: `T11 Lifecycle Co ${suffix}`, slug: `t11-lc-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const mintedUserId = randomUUID();
  await db.insert(users).values({
    id: mintedUserId,
    email: `${suffix}@e2e.local`,
    fullName: `T11 Lifecycle ${suffix}`,
    role: 'owner',
    status: 'active',
    companyId,
  });
  userId = mintedUserId;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Main', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  const [category] = await db
    .insert(categories)
    .values({
      companyId,
      brainId,
      slug: `t11-lc-cat-${suffix}`,
      name: 'T11 Lifecycle',
    })
    .returning({ id: categories.id });
  categoryId = category.id;

  const [scaffolding] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: `How ${suffix} Works`,
      slug: `how-${suffix}-works`,
      path: `t11-lc-cat-${suffix}/how-${suffix}-works`,
      content: scaffoldingContent(),
      type: 'agent-scaffolding',
      version: 1,
    })
    .returning({ id: documents.id });
  scaffoldingDocId = scaffolding.id;

  const [baseline] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: BASELINE_TITLE,
      slug: `brand-voice-${suffix}`,
      path: `t11-lc-cat-${suffix}/brand-voice-${suffix}`,
      content: baselineContent(),
      status: 'active',
      type: 'knowledge',
      version: 1,
    })
    .returning({ id: documents.id });
  baselineDocId = baseline.id;

  const built = buildAgentDefinitionDoc({
    title: 'Landing Page Copywriter',
    slug: `landing-copywriter-${suffix}`,
    model: 'claude-sonnet-4-6',
    toolAllowlist: null,
    baselineDocIds: [baselineDocId],
    skillIds: [],
    systemPromptSnippet: `Be ${suffix} and punchy.`,
  });

  const [agentDef] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: 'Landing Page Copywriter',
      slug: `landing-copywriter-${suffix}`,
      path: `t11-lc-cat-${suffix}/landing-copywriter-${suffix}`,
      content: built.content,
      type: 'agent-definition',
      version: 1,
    })
    .returning({ id: documents.id });
  agentDefinitionDocId = agentDef.id;

  // Synchronous rebuild so UserPromptSubmit never hits a missing
  // manifest (empty manifest is fine; the test doesn't rely on
  // skill matching).
  await rebuildManifest(companyId);

  const [session] = await db
    .insert(sessions)
    .values({
      companyId,
      brainId,
      userId,
      status: 'active',
      agentDefinitionId: agentDefinitionDocId,
    })
    .returning({ id: sessions.id });
  sessionId = session.id;

  mockAuth.userId = userId;
  mockAuth.companyId = companyId;
}, 120_000);

afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.companyId, companyId));
  await db.delete(usageRecords).where(eq(usageRecords.companyId, companyId));
  await db
    .delete(skillManifests)
    .where(eq(skillManifests.companyId, companyId));
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable`,
    );
    await tx.delete(auditEvents).where(eq(auditEvents.companyId, companyId));
    await tx.execute(
      sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable`,
    );
  });
  await db.delete(users).where(eq(users.id, userId));
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, companyId));

  mockProvider.reset();
  clearHooks();
  __resetContextHandlersForTests();
  __clearScaffoldingCacheForTests();
}, 120_000);

// --- Helpers ------------------------------------------------------------

async function flushWaitUntil(): Promise<void> {
  const pending = [...waitUntilPromises];
  waitUntilPromises.length = 0;
  await Promise.all(pending);
  await new Promise((r) => setTimeout(r, 0));
}

/** Run a chat turn through the real route + capture what the model saw.
 *  Shared helper — both the archived-note and (future) lifecycle tests
 *  want exactly the same setup: set a freshly-minted MockLanguageModelV3,
 *  fire the POST, drain the stream, hand the caller the prompt array. */
async function runChatAndCapturePrompt(
  userText: string,
): Promise<LanguageModelV3Message[]> {
  let capturedPrompt: LanguageModelV3Message[] = [];
  mockProvider.setModel(
    new MockLanguageModelV3({
      doStream: async (opts: LanguageModelV3CallOptions) => {
        capturedPrompt = opts.prompt as LanguageModelV3Message[];
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: 'ok' },
              { type: 'text-end', id: 't1' },
              {
                type: 'finish',
                usage: {
                  inputTokens: {
                    total: 50,
                    noCache: 50,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
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
    new Request('http://localhost/api/agent/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            id: 'user-msg-1',
            role: 'user',
            parts: [{ type: 'text', text: userText }],
          },
        ],
        sessionId,
      }),
    }),
  );
  expect(res.status).toBe(200);
  await res.text();
  await flushWaitUntil();
  return capturedPrompt;
}

// --- Tests ------------------------------------------------------------

describe('Agent lifecycle (integration, Task 11 Step 1)', () => {
  it(
    'DELETE on a baseline doc referenced by an agent-definition returns 409 with the referencing-agents list',
    async () => {
      const res = await brainDocDELETE(
        new Request(`http://localhost/api/brain/documents/${baselineDocId}`, {
          method: 'DELETE',
        }),
        { params: Promise.resolve({ id: baselineDocId }) },
      );
      expect(res.status).toBe(409);

      const body = (await res.json()) as {
        success: boolean;
        error: {
          code: string;
          details: {
            reason: string;
            agents: Array<{ id: string; title: string }>;
          };
        };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('document_in_use');
      // The agent list surfaces the referencing agent so the UI can
      // render "Detach from <Agent>" actions. Both fields are
      // user-visible: id for deep-linking, title for labels.
      expect(body.error.details.agents).toHaveLength(1);
      expect(body.error.details.agents[0].id).toBe(agentDefinitionDocId);
      expect(body.error.details.agents[0].title).toBe(
        'Landing Page Copywriter',
      );

      // The doc is still live — 409 short-circuited before the
      // soft-delete landed.
      const [stillThere] = await db
        .select({ id: documents.id, deletedAt: documents.deletedAt })
        .from(documents)
        .where(eq(documents.id, baselineDocId))
        .limit(1);
      expect(stillThere).toBeDefined();
      expect(stillThere.deletedAt).toBeNull();
    },
    60_000,
  );

  it(
    'archiving a referenced baseline surfaces the archived note in the next chat turn',
    async () => {
      // 1. Baseline starts active — assert the first turn carries the
      //    body WITHOUT an archived note. This is a negative baseline:
      //    without it, a false positive could sneak through if the
      //    archived note was accidentally always-on.
      const baselinePrompt = await runChatAndCapturePrompt(
        `first turn for ${suffix}`,
      );
      const baselineSystem = (
        baselinePrompt.filter((m) => m.role === 'system') as Array<{
          role: 'system';
          content: string;
        }>
      )[0];
      expect(baselineSystem).toBeDefined();
      expect(baselineSystem.content).toContain(BASELINE_MARKER);
      expect(baselineSystem.content).not.toMatch(/archived/i);

      // 2. Flip the baseline to archived.
      await db
        .update(documents)
        .set({ status: 'archived' })
        .where(eq(documents.id, baselineDocId));
      // Bust the scaffolding cache so the next turn actually re-reads
      // the row. The repo keys by (companyId, scaffolding-version) — a
      // status flip on the BASELINE doc doesn't bump the SCAFFOLDING
      // version, so the scaffolding cache entry stays valid. However
      // the builder re-fetches baseline docs every turn via
      // `getDocsByIds` (no cache), so the new status propagates
      // naturally. Clearing defensively in case future refactors add
      // caching here.
      __clearScaffoldingCacheForTests();

      try {
        // 3. Next turn — the SessionStart builder should now annotate
        //    the baseline block with an "archived" marker that reaches
        //    the model's system prompt verbatim.
        const archivedPrompt = await runChatAndCapturePrompt(
          `second turn for ${suffix}`,
        );
        const archivedSystem = (
          archivedPrompt.filter((m) => m.role === 'system') as Array<{
            role: 'system';
            content: string;
          }>
        )[0];
        expect(archivedSystem).toBeDefined();
        expect(archivedSystem.content).toContain(BASELINE_MARKER);
        // The literal annotation from buildScaffoldingPayload — a
        // case-insensitive "archived" match is enough here; the exact
        // wording lives in the scaffolding unit tests.
        expect(archivedSystem.content).toMatch(/archived/i);
      } finally {
        // Restore status so the suite doesn't leave residue for any
        // test running in parallel on the same DB.
        await db
          .update(documents)
          .set({ status: 'active' })
          .where(eq(documents.id, baselineDocId));
        __clearScaffoldingCacheForTests();
      }
    },
    180_000,
  );
});

// Suppress "unused" warnings on fixture ids the lifecycle test
// references indirectly (they pin the graph shape at setup time).
void scaffoldingDocId;

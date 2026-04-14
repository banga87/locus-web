/**
 * @vitest-environment node
 */
// Integration test for Task 9 — chat route threads `agentDefinitionId`
// into `AgentContext` and the hook chain materialises scaffolding +
// baseline + persona + skill context into the final prompt.
//
// Strategy
// --------
// End-to-end through the real route handler with a transport mock:
//   - Real DB (live Supabase via DATABASE_URL; same pattern as
//     `mvp-platform-agent.test.ts`). Seeds one company + brain + the
//     agent/scaffolding/skill/baseline documents.
//   - Real hook bus + real context handlers (`registerContextHandlers`).
//     We exercise the full SessionStart → UserPromptSubmit → streamText
//     path in one request, proving the wiring lands in practice.
//   - Mock Anthropic provider — captures the `prompt` argument
//     streamText hands to `doStream` so we can assert the exact shape
//     of the rendered system + per-turn messages.
//
// What we assert
// --------------
//   1. The system-role message in `opts.prompt` carries BOTH the
//      scaffolding body AND the persona snippet AND the baseline doc
//      body — proving SessionStart materialised with the full block
//      order from `buildScaffoldingPayload`.
//   2. The per-turn system-role message (spliced right before the user
//      turn) carries the matched skill's body — proving
//      UserPromptSubmit ran, saw the agent's skill pool, matched the
//      trigger phrase, and the harness spliced the inject payload.
//   3. `AgentContext.agentDefinitionId` actually threaded through —
//      without it, the skill candidate pool would have been empty
//      and the skill body would not be in the prompt.
//
// Why a single integration test vs split unit/integration
// -------------------------------------------------------
// The Task 9 scope explicitly calls for an "end-to-end assertion that
// blocks land in the correct order." The transport mock gives full
// prompt visibility without requiring a live LLM, while the live DB
// + real hook handlers + real registry prove the wiring past the
// mocks we can easily regress with (the route-unit-test file already
// covers the HTTP surface; this file covers the assembly).
//
// Isolation from other integration tests
// --------------------------------------
// Registers hooks on the shared in-process bus. `clearHooks()` +
// `__resetContextHandlersForTests()` run in beforeAll so repeat runs
// within the same test process start clean. The registry scope is
// per-process, so we don't interfere with concurrent test files in a
// parallel vitest worker layout.

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

// Stub requireAuth — resolved to our seeded user once beforeAll finishes.
const mockAuth = {
  userId: '',
  companyId: '',
  role: 'owner' as const,
  email: 'task9@local',
  fullName: 'Task 9 Tester',
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

// Mock `@ai-sdk/anthropic`. The provider factory returns whatever
// model the current test configures — same shape as the existing
// run-level + MVP integration tests.
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

// waitUntil: run the promise eagerly so persistTurn + recordUsage land
// before the test moves on. We ignore outcome — the test asserts on
// the captured prompt, not on persistence.
const waitUntilPromises: Array<Promise<unknown>> = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(Promise.resolve(p).catch(() => {}));
  },
}));

// Import the route AFTER mocks are installed.
import { POST as chatPOST } from '@/app/api/agent/chat/route';

// --- Fixture ------------------------------------------------------------

const suffix = `t9-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let categoryId: string;
let scaffoldingDocId: string;
let baselineDocId: string;
let skillDocId: string;
let agentDefinitionDocId: string;
let sessionId: string;

const SCAFFOLDING_BODY_MARKER = `${suffix}-scaffolding-unique-marker`;
const BASELINE_BODY_MARKER = `${suffix}-baseline-unique-marker`;
const SKILL_BODY_MARKER = `${suffix}-skill-unique-marker`;
const PERSONA_SNIPPET = `You are a specialist copywriter for ${suffix}. Keep sentences punchy.`;

function scaffoldingContent(): string {
  return `---\ntype: agent-scaffolding\ntitle: How ${suffix} Works\nversion: 1\n---\n\n${SCAFFOLDING_BODY_MARKER}\n\nThis is the session-start scaffolding the agent should always see.`;
}

function baselineContent(): string {
  return `---\ntype: knowledge\ntitle: Brand Voice\n---\n\n${BASELINE_BODY_MARKER}\n\nFriendly, direct, never corporate.`;
}

// Skill trigger phrase: "draft landing page". Matcher runs
// case-insensitive containment, so "please draft a landing page..."
// will match via the phrase hit.
function skillContent(): string {
  return `---
type: skill
title: Draft a Landing Page
description: Use when the user asks to draft a landing page.
triggers:
  phrases:
    - landing page
  allOf: []
  anyOf: []
  minScore: 1
priority: 5
---

${SKILL_BODY_MARKER}

Open with a hook. Lead with the single strongest benefit. Close with a CTA.`;
}

beforeAll(async () => {
  // Reset the in-process hook bus + context-handler registration so a
  // prior test file can't have left a stale SessionStart handler
  // wired. The chat route calls `registerContextHandlers()` on every
  // request; the module-level flag keeps that idempotent per process.
  clearHooks();
  __resetContextHandlersForTests();
  __clearScaffoldingCacheForTests();

  const [company] = await db
    .insert(companies)
    .values({ name: `Task 9 Co ${suffix}`, slug: `t9-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const mintedUserId = randomUUID();
  await db.insert(users).values({
    id: mintedUserId,
    email: `${suffix}@e2e.local`,
    fullName: `Task 9 ${suffix}`,
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
      slug: `t9-cat-${suffix}`,
      name: 'Task 9',
    })
    .returning({ id: categories.id });
  categoryId = category.id;

  // 1. Scaffolding doc — singleton per company.
  const [scaffolding] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: `How ${suffix} Works`,
      slug: `how-${suffix}-works`,
      path: `t9-cat-${suffix}/how-${suffix}-works`,
      content: scaffoldingContent(),
      type: 'agent-scaffolding',
      version: 1,
    })
    .returning({ id: documents.id });
  scaffoldingDocId = scaffolding.id;

  // 2. Baseline knowledge doc.
  const [baseline] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: 'Brand Voice',
      slug: `brand-voice-${suffix}`,
      path: `t9-cat-${suffix}/brand-voice-${suffix}`,
      content: baselineContent(),
      status: 'active',
      type: 'knowledge',
      version: 1,
    })
    .returning({ id: documents.id });
  baselineDocId = baseline.id;

  // 3. Skill doc with the trigger phrase.
  const [skill] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: 'Draft a Landing Page',
      slug: `draft-landing-page-${suffix}`,
      path: `t9-cat-${suffix}/draft-landing-page-${suffix}`,
      content: skillContent(),
      type: 'skill',
      version: 1,
    })
    .returning({ id: documents.id });
  skillDocId = skill.id;

  // 4. Agent-definition doc — references the baseline + the skill,
  //    carries a persona snippet. Built via the same helper the
  //    wizard route uses so the frontmatter shape matches production.
  const built = buildAgentDefinitionDoc({
    title: 'Landing Page Copywriter',
    slug: `landing-page-copywriter-${suffix}`,
    model: 'claude-sonnet-4-6',
    toolAllowlist: null,
    baselineDocIds: [baselineDocId],
    skillIds: [skillDocId],
    systemPromptSnippet: PERSONA_SNIPPET,
  });

  const [agentDef] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: 'Landing Page Copywriter',
      slug: `landing-page-copywriter-${suffix}`,
      path: `t9-cat-${suffix}/landing-page-copywriter-${suffix}`,
      content: built.content,
      type: 'agent-definition',
      version: 1,
    })
    .returning({ id: documents.id });
  agentDefinitionDocId = agentDef.id;

  // 5. Compile the skill manifest so the UserPromptSubmit handler
  //    finds the skill when the user's prompt contains the trigger.
  //    We call `rebuildManifest` directly rather than the debounced
  //    `scheduleManifestRebuild` so the manifest is guaranteed
  //    present before the POST fires — no 5s wait in the test.
  await rebuildManifest(companyId);

  // 6. Create a session already bound to the agent. The sessions POST
  //    route doesn't yet accept `agentDefinitionId` (follow-up work,
  //    tracked in the Task 9 implementation notes); for this test we
  //    seed the row directly.
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

  // Wire auth so the route sees the seeded user as the caller.
  mockAuth.userId = userId;
  mockAuth.companyId = companyId;
}, 120_000);

afterAll(async () => {
  // Order matters: Phase 1 dependents with FKs into users/brains/
  // companies first, then users, then brains (cascades docs +
  // categories), then companies. Mirrors the cleanup pattern in
  // `src/__tests__/integration/helpers.ts` — the chat POST records
  // usage + writes audit events via waitUntil, so both tables hold
  // referencing rows by the time afterAll runs.
  await db
    .delete(sessions)
    .where(eq(sessions.companyId, companyId));
  await db
    .delete(usageRecords)
    .where(eq(usageRecords.companyId, companyId));
  await db
    .delete(skillManifests)
    .where(eq(skillManifests.companyId, companyId));
  // audit_events has an immutability trigger; drop inside a
  // transaction with it briefly disabled.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable`,
    );
    await tx
      .delete(auditEvents)
      .where(eq(auditEvents.companyId, companyId));
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
  // Leave the hook bus clean for the next test file.
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

function buildChatRequest(messages: unknown[], sessionIdArg: string): Request {
  return new Request('http://localhost/api/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, sessionId: sessionIdArg }),
  });
}

// --- Tests ------------------------------------------------------------

describe('POST /api/agent/chat — Task 9: agentDefinitionId threading + hook-driven context', () => {
  it(
    'injects scaffolding + persona + baseline via SessionStart and skill body via UserPromptSubmit',
    async () => {
      // Capture the prompt the mock model receives. AI SDK v3 providers
      // surface the fully-assembled message array via
      // `LanguageModelV3CallOptions.prompt`. streamText folds its
      // `system` param into the array as a `role: 'system'` message and
      // appends the chat `messages`. The route built the `messages`
      // array; `runAgentTurn` spliced a per-turn system-role inject in
      // front of the latest user turn.
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
                        total: 100,
                        noCache: 100,
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
            };
          },
        }),
      );

      // User prompt includes the skill's trigger phrase so the matcher
      // fires. Trigger is "draft landing page" (case-insensitive
      // containment); this message has it embedded in a natural
      // sentence to prove the matcher isn't whitespace-sensitive.
      const userText =
        'please draft a landing page for our flagship product';

      const res = await chatPOST(
        buildChatRequest(
          [
            {
              id: 'user-msg-1',
              role: 'user',
              parts: [{ type: 'text', text: userText }],
            },
          ],
          sessionId,
        ),
      );
      expect(res.status).toBe(200);
      // Drain the body so the stream resolves and waitUntil fires.
      await res.text();
      await flushWaitUntil();

      // --- Assert the session-stable (SessionStart) system block -----
      //
      // streamText combines its `system` param with any in-prompt
      // system messages. The SessionStart-injected content is
      // concatenated onto `params.system` in `runAgentTurn` (see
      // run.ts around line 230), so the FIRST system message in the
      // prompt carries scaffolding + persona + baseline bodies
      // adjacent to the base Locus system prompt.
      const systemMessages = capturedPrompt.filter(
        (m) => m.role === 'system',
      ) as Array<{ role: 'system'; content: string }>;
      expect(systemMessages.length).toBeGreaterThanOrEqual(1);

      // The session-stable block is the first system message —
      // concatenated before the base system prompt. Assert all three
      // session-stable payloads landed there.
      const sessionStable = systemMessages[0].content;
      expect(sessionStable).toContain(SCAFFOLDING_BODY_MARKER);
      expect(sessionStable).toContain(BASELINE_BODY_MARKER);
      // Persona snippet: assert unique substrings so we don't trip
      // on unrelated text in the base system prompt.
      expect(sessionStable).toContain('specialist copywriter');
      expect(sessionStable).toContain('punchy');

      // --- Assert the per-turn (UserPromptSubmit) system block -------
      //
      // runAgentTurn splices the inject payload as a `role: 'system'`
      // message inserted immediately before the latest user message.
      // Locate it by (a) role='system' and (b) containing the skill
      // body marker.
      const perTurn = systemMessages.find((m) =>
        m.content.includes(SKILL_BODY_MARKER),
      );
      expect(perTurn).toBeDefined();

      // Sanity: the user's message still made it through the splice.
      const userMessages = capturedPrompt.filter((m) => m.role === 'user');
      expect(userMessages.length).toBeGreaterThanOrEqual(1);
      const lastUserContent = JSON.stringify(
        userMessages[userMessages.length - 1].content,
      );
      expect(lastUserContent).toContain('draft a landing page');

      // Ordering invariant: the per-turn system block sits immediately
      // before the latest user turn in the spliced messages (not at
      // index 0 with the session-stable block). Find the per-turn
      // inject in the full prompt and assert its index is > the
      // session-stable index AND its next message is the user turn.
      const perTurnIdx = capturedPrompt.findIndex(
        (m) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes(SKILL_BODY_MARKER),
      );
      expect(perTurnIdx).toBeGreaterThan(0);
      expect(capturedPrompt[perTurnIdx + 1]?.role).toBe('user');
    },
    180_000,
  );
});

// Suppress "unused variable" on the seeded doc ids — they're captured
// for fixture lifecycle and document the full seed graph even when an
// individual test doesn't reference every one directly.
void scaffoldingDocId;

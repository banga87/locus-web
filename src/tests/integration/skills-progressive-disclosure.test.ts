/**
 * @vitest-environment node
 */
// Integration test for PR1 — progressive-disclosure skills.
//
// Covers the full runtime path PR1 introduced: an agent-definition's
// `skills:` frontmatter resolves to an <available-skills> block in the
// system prompt (name + description + id, filtered to the allowlist),
// and the `load_skill` / `read_skill_file` tools return the skill body
// (frontmatter stripped) + nested resource paths — or an `unavailable`
// error when the caller passes an id outside the allowlist.
//
// Strategy
// --------
// Mix of end-to-end (Part A) and direct-tool (Part B) assertions.
//   Part A: seed real rows + mock Anthropic transport + fire the real
//   chat route handler. Capture `opts.prompt` and assert the system
//   message contains the allowlisted skill's <available-skills> entry
//   AND omits the unlisted skill. This is the UNIQUE integration value
//   over the existing tool unit tests — it proves the route plumbs
//   agent-definition skill ids all the way to the system prompt.
//
//   Part B: call `load_skill` / `read_skill_file` directly (the same
//   pattern the existing unit tests use) to assert the allowlist +
//   body + files/content payloads against the live DB seed. Keeps the
//   scope tight: the unit tests already cover the same scenarios but
//   on a fresh fixture set, so this re-test guards against regressions
//   in the shared fixture layout used here.
//
// Fixture pattern mirrors `route.integration.test.ts` + `agent-lifecycle
// .test.ts`: live DB via service-role DATABASE_URL, mocked Anthropic
// transport, mocked requireAuth, hook bus cleared in beforeAll, and
// `DISABLE TRIGGER` / `DELETE` / `ENABLE TRIGGER` for audit_events +
// document_versions in afterAll.

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
  folders,
  companies,
  documents,
  sessions,
  usageRecords,
  users,
} from '@/db/schema';
import { buildAgentDefinitionDoc } from '@/lib/agents/definitions';
import { __clearScaffoldingCacheForTests } from '@/lib/context/repos';
import { __resetContextHandlersForTests } from '@/lib/context/register';
import { clearHooks } from '@/lib/agent/hooks';
import {
  deriveResourcePath,
  deriveResourceSlug,
} from '@/lib/skills/resource-slug';
import { loadSkillTool } from '@/lib/tools/implementations/load-skill';
import { readSkillFileTool } from '@/lib/tools/implementations/read-skill-file';
import type { ToolContext } from '@/lib/tools/types';

// --- Module mocks -------------------------------------------------------

const mockAuth = {
  userId: '',
  companyId: '',
  role: 'owner' as const,
  email: 'pr1-skills@local',
  fullName: 'PR1 Skills Tester',
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

// `@/lib/axiom/server` transitively imports `@axiomhq/nextjs`, which has
// an extension-less `import ... from 'next/server'` that Node 22's
// native ESM resolver rejects under next@16 (no `exports` map, no
// `.js` extension). Tests don't need real logging — stub the logger so
// the broken import chain never loads.
vi.mock('@/lib/axiom/server', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  withAxiom: <Ctx,>(handler: unknown) => handler as Ctx,
}));

const waitUntilPromises: Array<Promise<unknown>> = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(Promise.resolve(p).catch(() => {}));
  },
}));

// Import route AFTER mocks are installed so the mocked modules land.
import { POST as chatPOST } from '@/app/api/agent/chat/route';

// --- Fixture ------------------------------------------------------------

const suffix = `pr1-sk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let folderId: string;
let allowedSkillId: string;
let unlistedSkillId: string;
let resourceRelativePath = 'refs/a.md';
let resourceContent = 'Reference A content';
let agentDefinitionDocId: string;
let sessionId: string;

const ALLOWED_SKILL_NAME = 'Test Skill';
const ALLOWED_SKILL_DESC = 'Use when running skills tests.';
const ALLOWED_SKILL_INSTRUCTIONS = `# Instructions

Do stuff.`;

const UNLISTED_SKILL_NAME = 'Unlisted Skill';
const UNLISTED_SKILL_DESC = 'Should not appear.';

function allowedSkillContent(): string {
  return `---\ntype: skill\nname: ${ALLOWED_SKILL_NAME}\ndescription: ${ALLOWED_SKILL_DESC}\n---\n\n${ALLOWED_SKILL_INSTRUCTIONS}`;
}

function unlistedSkillContent(): string {
  return `---\ntype: skill\nname: ${UNLISTED_SKILL_NAME}\ndescription: ${UNLISTED_SKILL_DESC}\n---\n\n# Unlisted\n\nSecret.`;
}

beforeAll(async () => {
  // Start clean: a prior test file's handlers / scaffolding cache entries
  // must not leak into this suite's first chat turn.
  clearHooks();
  __resetContextHandlersForTests();
  __clearScaffoldingCacheForTests();

  const [company] = await db
    .insert(companies)
    .values({ name: `PR1 Skills Co ${suffix}`, slug: `pr1-sk-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const mintedUserId = randomUUID();
  await db.insert(users).values({
    id: mintedUserId,
    email: `${suffix}@e2e.local`,
    fullName: `PR1 Skills ${suffix}`,
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

  const [folder] = await db
    .insert(folders)
    .values({
      companyId,
      brainId,
      slug: `pr1-sk-cat-${suffix}`,
      name: 'PR1 Skills',
    })
    .returning({ id: folders.id });
  folderId = folder.id;

  // 1. Allowed skill root doc — the agent-definition will reference this.
  const allowedSkillSlug = `test-skill-${suffix}`;
  const [allowedSkill] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: ALLOWED_SKILL_NAME,
      slug: allowedSkillSlug,
      path: `pr1-sk-cat-${suffix}/${allowedSkillSlug}`,
      content: allowedSkillContent(),
      type: 'skill',
      status: 'active',
      version: 1,
    })
    .returning({ id: documents.id });
  allowedSkillId = allowedSkill.id;

  // 2. Allowed skill's single nested resource. `skill-resource` rows are
  //    platform-internal — slug/path values are synthesised.
  const resourceId = randomUUID();
  await db.insert(documents).values({
    id: resourceId,
    companyId,
    brainId,
    // `folderId` intentionally omitted — skill-resources live outside the
    // folder tree.
    title: resourceRelativePath,
    slug: deriveResourceSlug(resourceId),
    path: deriveResourcePath(allowedSkillSlug, resourceRelativePath),
    content: resourceContent,
    type: 'skill-resource',
    parentSkillId: allowedSkillId,
    relativePath: resourceRelativePath,
    status: 'active',
    version: 1,
  });

  // 3. A SECOND skill root doc — NOT referenced by the agent-definition.
  //    Proves the <available-skills> filter isn't "show every skill in
  //    the company"; it's strictly the ids in the definition's
  //    `skills:` frontmatter.
  const unlistedSkillSlug = `unlisted-skill-${suffix}`;
  const [unlistedSkill] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: UNLISTED_SKILL_NAME,
      slug: unlistedSkillSlug,
      path: `pr1-sk-cat-${suffix}/${unlistedSkillSlug}`,
      content: unlistedSkillContent(),
      type: 'skill',
      status: 'active',
      version: 1,
    })
    .returning({ id: documents.id });
  unlistedSkillId = unlistedSkill.id;

  // 4. Agent-definition doc — references ONLY the allowed skill.
  //    Built via the same helper the wizard route uses so the
  //    frontmatter key order / shape matches production; the repo
  //    parses back by reading `skills:` from YAML.
  const built = buildAgentDefinitionDoc({
    title: 'Skills Test Agent',
    slug: `skills-test-agent-${suffix}`,
    model: 'claude-sonnet-4-6',
    toolAllowlist: null,
    baselineDocIds: [],
    skillIds: [allowedSkillId],
    systemPromptSnippet: `You are the PR1 ${suffix} agent.`,
    capabilities: [],
  });

  const [agentDef] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: 'Skills Test Agent',
      slug: `skills-test-agent-${suffix}`,
      path: `pr1-sk-cat-${suffix}/skills-test-agent-${suffix}`,
      content: built.content,
      type: 'agent-definition',
      version: 1,
    })
    .returning({ id: documents.id });
  agentDefinitionDocId = agentDef.id;

  // 5. Session bound to the agent-definition so the chat route's
  //    agentDefinitionId lookup resolves to `agentDefinitionDocId`.
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
  // Order: sessions → usage_records → audit_events → users → brains
  // (cascades docs + folders + skill-resources via parent_skill_id) →
  // companies. Mirrors agent-lifecycle.test.ts.
  await db.delete(sessions).where(eq(sessions.companyId, companyId));
  await db.delete(usageRecords).where(eq(usageRecords.companyId, companyId));
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

/** Run a single chat turn; capture the prompt messages the mock LLM sees. */
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

function baseToolContext(agentSkillIds: string[]): ToolContext {
  // Minimal ToolContext — read tools in this test don't touch write-only
  // fields. `actor.scopes=['read']` matches what the chat route sets
  // for platform agents.
  const tokenId = randomUUID();
  return {
    actor: {
      type: 'platform_agent',
      id: userId,
      name: 'PR1 Skills Tester',
      scopes: ['read'],
    },
    companyId,
    brainId,
    tokenId,
    grantedCapabilities: [],
    agentSkillIds,
    webCallsThisTurn: 0,
  };
}

// --- Tests ------------------------------------------------------------

describe('Skills progressive disclosure (PR1 integration)', () => {
  it(
    'chat route injects <available-skills> with ONLY allowlisted skills into the system prompt',
    async () => {
      const prompt = await runChatAndCapturePrompt(
        `hello from ${suffix} — skills integration test`,
      );

      const systemMessages = prompt.filter((m) => m.role === 'system') as Array<
        { role: 'system'; content: string }
      >;
      expect(systemMessages.length).toBeGreaterThanOrEqual(1);

      // `buildSystemPrompt` renders the <available-skills> block into
      // the BASE system prompt. `runAgentTurn` concatenates the
      // session-stable inject onto `params.system`, so the first
      // system message in the captured prompt carries both the inject
      // payload and the base prompt (with the skills block).
      const combined = systemMessages.map((m) => m.content).join('\n\n');

      // --- Positive assertions -----------------------------------------
      // The available-skills block header + the allowed skill's id,
      // name, and description should all be present.
      expect(combined).toContain('<available-skills>');
      expect(combined).toContain('</available-skills>');
      expect(combined).toContain(`id: ${allowedSkillId}`);
      expect(combined).toContain(`name: ${ALLOWED_SKILL_NAME}`);
      expect(combined).toContain(`description: ${ALLOWED_SKILL_DESC}`);

      // --- Negative assertion (the unique integration value) ----------
      // The unlisted skill lives in the same company+brain and has
      // type='skill'. If the route ever regressed to "show every skill
      // in the brain" instead of "filter to the agent-definition
      // allowlist," this assertion is the only thing that catches it.
      expect(combined).not.toContain(unlistedSkillId);
      expect(combined).not.toContain(UNLISTED_SKILL_NAME);
      expect(combined).not.toContain(UNLISTED_SKILL_DESC);
    },
    180_000,
  );

  it('load_skill returns body (frontmatter stripped) + nested resource paths for an allowed skill', async () => {
    const result = await loadSkillTool.call(
      { skill_id: allowedSkillId },
      baseToolContext([allowedSkillId]),
    );
    expect(result.success).toBe(true);
    // Frontmatter stripped — body starts with the `# Instructions`
    // heading from allowedSkillContent().
    expect(result.data?.body).toContain('# Instructions');
    expect(result.data?.body).not.toMatch(/^---\n/);
    // The resource seeded above surfaces in the files list.
    expect(result.data?.files).toEqual([resourceRelativePath]);
  });

  it('load_skill returns unavailable when the skill is NOT in agentSkillIds', async () => {
    // Agent allowlist excludes the skill id — the route's gate rejects.
    const result = await loadSkillTool.call(
      { skill_id: allowedSkillId },
      baseToolContext([]),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('unavailable');
  });

  it('read_skill_file returns the resource content for an allowed skill + known path', async () => {
    const result = await readSkillFileTool.call(
      { skill_id: allowedSkillId, relative_path: resourceRelativePath },
      baseToolContext([allowedSkillId]),
    );
    expect(result.success).toBe(true);
    expect(result.data?.content).toBe(resourceContent);
  });

  it('read_skill_file returns unavailable when the skill is NOT in agentSkillIds', async () => {
    const result = await readSkillFileTool.call(
      { skill_id: allowedSkillId, relative_path: resourceRelativePath },
      baseToolContext([]),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('unavailable');
  });
});

// Suppress "unused" warnings on fixture ids + helpers captured for
// setup symmetry.
void folderId;
void agentDefinitionDocId;

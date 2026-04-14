/**
 * @vitest-environment node
 */
// Integration test for Task 11 Step 2 — ingestion end-to-end.
//
// This is the test nothing else stitches together. Upstream integration
// tests cover the PIECES:
//   - Task 8's `attachments/route.integration.test.ts` covers upload +
//     extraction (via the real route handler, mocked Supabase Storage).
//   - Task 6's `user-prompt.integration.test.ts` covers the
//     UserPromptSubmit inject payload in isolation.
//   - Task 9's `chat/route.integration.test.ts` covers the inject
//     payload reaching the system prompt end-to-end.
//   - Task 7's `propose-document.test.ts` covers the pure tool execute.
//   - Task 4's `agents.test.ts` / Task 1's `documents.test.ts` cover the
//     Brain CRUD shape on unit level.
//
// But NONE of them prove a user can: upload → agent sees it →
// agent proposes file → user approves → brain doc exists +
// attachment transitions to `committed` with `committed_doc_id`
// pointing at the new doc. That is the "does the flow actually work"
// assertion this test owns.
//
// Strategy
// --------
//   - Live DB (same service-role connection as the other integration
//     tests). Seeds one company + brain + user + category + session +
//     minimal agent-definition (so the chat route's SessionStart
//     handler doesn't explode on missing scaffolding).
//   - Real attachments route handler (POST /api/attachments), with
//     Supabase auth + storage mocked to avoid a real bucket.
//   - Real chat route handler, with the Anthropic provider mocked to
//     return a tool-call to `propose_document_create` whose arguments
//     name the attachment the user just uploaded.
//   - After the turn completes, simulate the Approve button: call
//     POST /api/brain/documents directly with the proposal payload +
//     the attachment id. Assert:
//       1. A new brain doc exists.
//       2. `session_attachments.status = 'committed'`.
//       3. `session_attachments.committed_doc_id` = new doc id.
//
// What this test does NOT assert (covered elsewhere):
//   - The exact shape of the `isProposal` tool-result payload on the
//     UI stream (`propose-document.test.ts` + `tool-display-names.test
//     .ts`). Here we only verify the agent's tool call round-trips
//     through the chat route without error.
//   - The chat route's audit/usage side-writes (Task 9 integration
//     test already covers waitUntil-persisted rows).

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';

import { db } from '@/db';
import {
  auditEvents,
  brains,
  categories,
  companies,
  documents,
  sessionAttachments,
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

// --- Mocks --------------------------------------------------------------

const mockAuth = {
  userId: '',
  companyId: '',
  role: 'owner' as const,
  email: 't11-ing@local',
  fullName: 'Task 11 Ingestion Tester',
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

// Supabase mock: auth returns a plain object (the attachments route
// needs `data.user` present), and Storage.upload is a no-op that
// succeeds. This is cross-module — the attachments route imports the
// client directly, so we stub the whole `@/lib/supabase/server`.
let supabaseUserId: string | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: supabaseUserId
            ? { id: supabaseUserId, email: 'ingest@example.com' }
            : null,
        },
      }),
    },
    storage: {
      from: (_bucket: string) => ({
        upload: async (key: string) => ({ data: { path: key }, error: null }),
      }),
    },
  }),
}));

// Anthropic provider mock — the test sets the current model per turn.
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
  setModel(m: LanguageModelV3): void {
    this.current = m;
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

// Imports AFTER mocks.
import { POST as attachmentsPOST } from '@/app/api/attachments/route';
import { POST as chatPOST } from '@/app/api/agent/chat/route';
import { POST as brainDocPOST } from '@/app/api/brain/documents/route';

// --- Fixture ------------------------------------------------------------

const suffix = `t11-ing-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let categoryId: string;
let sessionId: string;

beforeAll(async () => {
  clearHooks();
  __resetContextHandlersForTests();
  __clearScaffoldingCacheForTests();

  const [company] = await db
    .insert(companies)
    .values({ name: `T11 Ing Co ${suffix}`, slug: `t11-ing-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const mintedUserId = randomUUID();
  await db.insert(users).values({
    id: mintedUserId,
    email: `${suffix}@e2e.local`,
    fullName: `T11 Ing ${suffix}`,
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
      slug: `t11-ing-cat-${suffix}`,
      name: 'T11 Ing',
    })
    .returning({ id: categories.id });
  categoryId = category.id;

  // A scaffolding doc so SessionStart doesn't warn-log an empty
  // payload. Minimal content — the test doesn't assert on its body.
  await db.insert(documents).values({
    companyId,
    brainId,
    categoryId,
    title: 'Scaffolding',
    slug: `scaffolding-${suffix}`,
    path: `t11-ing-cat-${suffix}/scaffolding-${suffix}`,
    content: `---\ntype: agent-scaffolding\ntitle: Scaffolding\n---\n\nContext.`,
    type: 'agent-scaffolding',
    version: 1,
  });

  // Minimal agent-definition doc — no baselines, no skills. Lets the
  // chat route's SessionStart + UserPromptSubmit handlers run cleanly.
  const built = buildAgentDefinitionDoc({
    title: 'Ingestion Agent',
    slug: `ingestion-agent-${suffix}`,
    model: 'claude-sonnet-4-6',
    toolAllowlist: null,
    baselineDocIds: [],
    skillIds: [],
    systemPromptSnippet: 'File uploads promptly.',
  });
  const [agentDef] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: 'Ingestion Agent',
      slug: `ingestion-agent-${suffix}`,
      path: `t11-ing-cat-${suffix}/ingestion-agent-${suffix}`,
      content: built.content,
      type: 'agent-definition',
      version: 1,
    })
    .returning({ id: documents.id });

  await rebuildManifest(companyId);

  const [session] = await db
    .insert(sessions)
    .values({
      companyId,
      brainId,
      userId,
      status: 'active',
      agentDefinitionId: agentDef.id,
    })
    .returning({ id: sessions.id });
  sessionId = session.id;

  mockAuth.userId = userId;
  mockAuth.companyId = companyId;
  supabaseUserId = userId;
}, 120_000);

afterAll(async () => {
  await db
    .delete(sessionAttachments)
    .where(eq(sessionAttachments.companyId, companyId));
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
  supabaseUserId = null;
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

function loadFixture(name: string): Buffer {
  return readFileSync(
    resolve(
      __dirname,
      '..',
      '..',
      'lib',
      'ingestion',
      '__fixtures__',
      name,
    ),
  );
}

/** Build a multipart upload Request. Mirrors the helper used in
 *  `src/app/api/attachments/__tests__/route.integration.test.ts`. */
function buildMultipartRequest(
  fileBuf: Buffer,
  filename: string,
  mimeType: string,
  sessionIdArg: string,
): Request {
  const form = new FormData();
  const view = new Uint8Array(fileBuf);
  const blob = new Blob([view], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });
  form.set('file', file);
  form.set('sessionId', sessionIdArg);
  return new Request('http://localhost/api/attachments', {
    method: 'POST',
    body: form,
  });
}

// --- Tests --------------------------------------------------------------

describe('Ingestion end-to-end (integration, Task 11 Step 2)', () => {
  it(
    'upload → extract → chat-turn → approve → commit: attachment transitions to committed with committed_doc_id set',
    async () => {
      // 1. Upload — real route handler, real DB write.
      const buf = loadFixture('sample.pdf');
      const uploadRes = await attachmentsPOST(
        buildMultipartRequest(
          buf,
          'brand-brief.pdf',
          'application/pdf',
          sessionId,
        ),
      );
      expect(uploadRes.status).toBe(200);
      const uploadPayload = (await uploadRes.json()) as {
        success: boolean;
        data: { id: string; status: string };
      };
      expect(uploadPayload.success).toBe(true);
      expect(uploadPayload.data.status).toBe('extracted');
      const attachmentId = uploadPayload.data.id;

      // DB sanity — the row landed with extracted_text.
      const [attachRow] = await db
        .select()
        .from(sessionAttachments)
        .where(eq(sessionAttachments.id, attachmentId))
        .limit(1);
      expect(attachRow).toBeDefined();
      expect(attachRow.status).toBe('extracted');
      expect(attachRow.extractedText).toBeTruthy();

      // 2. Chat turn. The mock model returns a tool-call to
      //    propose_document_create. We don't assert on stream shape
      //    here (covered by the tool unit test); we only need the turn
      //    to complete without error so the UserPromptSubmit handler
      //    has a chance to inject the attachment + (if the filing
      //    skill is seeded) the filing guidance. The test
      //    deliberately skips seeding the filing skill — its absence
      //    is a tolerated degradation on pre-Task-10 companies.
      mockProvider.setModel(
        new MockLanguageModelV3({
          doStream: async (_opts: LanguageModelV3CallOptions) => {
            return {
              stream: simulateReadableStream({
                chunks: [
                  { type: 'stream-start', warnings: [] },
                  {
                    type: 'tool-input-start',
                    id: 'tool-1',
                    toolName: 'propose_document_create',
                  },
                  {
                    type: 'tool-input-delta',
                    id: 'tool-1',
                    delta: JSON.stringify({
                      category: 'sources',
                      type: 'knowledge',
                      title: `Brand Brief ${suffix}`,
                      frontmatter: { tags: ['source', 'ingested'] },
                      body_markdown: 'Filed from upload.',
                      rationale: 'User asked to file the uploaded brief.',
                    }),
                  },
                  { type: 'tool-input-end', id: 'tool-1' },
                  {
                    type: 'tool-call',
                    toolCallId: 'tool-1',
                    toolName: 'propose_document_create',
                    input: {
                      category: 'sources',
                      type: 'knowledge',
                      title: `Brand Brief ${suffix}`,
                      frontmatter: { tags: ['source', 'ingested'] },
                      body_markdown: 'Filed from upload.',
                      rationale: 'User asked to file the uploaded brief.',
                    },
                  },
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
                    finishReason: { unified: 'tool-calls', raw: 'tool_use' },
                  },
                ] satisfies LanguageModelV3StreamPart[],
              }),
            };
          },
        }),
      );

      const chatRes = await chatPOST(
        new Request('http://localhost/api/agent/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages: [
              {
                id: 'user-msg-ingest-1',
                role: 'user',
                parts: [
                  {
                    type: 'text',
                    text: 'please file this brand brief I just uploaded',
                  },
                ],
              },
            ],
            sessionId,
          }),
        }),
      );
      expect(chatRes.status).toBe(200);
      // Drain the stream so onFinish fires via waitUntil.
      await chatRes.text();
      await flushWaitUntil();

      // 3. Approve: simulate the client-side approve handler by POSTing
      //    the proposal payload plus the attachment id to the real
      //    Brain CRUD route. This is the same path the UI takes when
      //    the user clicks Approve on a proposal card (see
      //    `src/components/chat/proposal-card.tsx::submitCreate`).
      const approveRes = await brainDocPOST(
        new Request('http://localhost/api/brain/documents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: `Brand Brief ${suffix}`,
            slug: `brand-brief-${suffix}`,
            content: 'Filed from upload.',
            categoryId,
            attachmentId,
          }),
        }),
      );
      expect(approveRes.status).toBe(201);
      const approveBody = (await approveRes.json()) as {
        success: boolean;
        data: { id: string; title: string };
      };
      expect(approveBody.success).toBe(true);
      expect(approveBody.data.title).toBe(`Brand Brief ${suffix}`);
      const newDocId = approveBody.data.id;

      // 4. Attachment transitioned to `committed` and points at the
      //    new doc. `markCommitted` is fire-and-forget inside the POST
      //    handler (await'd but with a try/catch that logs), so the
      //    row's state IS observable by the time the response returns.
      const [finalAttach] = await db
        .select()
        .from(sessionAttachments)
        .where(eq(sessionAttachments.id, attachmentId))
        .limit(1);
      expect(finalAttach).toBeDefined();
      expect(finalAttach.status).toBe('committed');
      expect(finalAttach.committedDocId).toBe(newDocId);

      // 5. And the new doc exists on disk with the right shape.
      const [newDoc] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, newDocId))
        .limit(1);
      expect(newDoc).toBeDefined();
      expect(newDoc.title).toBe(`Brand Brief ${suffix}`);
      expect(newDoc.companyId).toBe(companyId);
      expect(newDoc.deletedAt).toBeNull();
    },
    180_000,
  );
});

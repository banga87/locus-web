/**
 * @vitest-environment node
 */
// Integration test for the agent-led skill authoring path:
//   1. Simulate agent calling `propose_skill_create` via direct tool.execute()
//      → assert isProposal: true, proposal.kind === 'skill-create', fields pass through.
//   2. POST the same payload (minus `kind`) to /api/skills/propose/accept
//      → assert 201 + { skill_id }, assert skill tree landed in DB.
//
// Mocking strategy:
//   - @/lib/axiom/server: mock to avoid @axiomhq/nextjs / next/server resolution
//     issues under Node 22 + Next 16.
//   - @/lib/supabase/server: mock auth so requireAuth resolves to the fixture user.
//   - The tool (proposeSkillCreateTool) is NOT mocked — called directly via execute().
//   - Everything else (drizzle, route handler, writeSkillTree, etc.) runs real.

import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import {
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from '@/lib/tools/__tests__/_fixtures';

// ---- Axiom mock (REQUIRED — avoids @axiomhq/nextjs / next/server resolution under Node 22) ----
vi.mock('@/lib/axiom/server', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withAxiom: (handler: unknown) => handler,
}));

// ---- Fixtures ----------------------------------------------------------------
let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await setupFixtures('skills-agent-led-authoring');
});

afterAll(async () => {
  if (fixtures) await teardownFixtures(fixtures);
});

// ---- Supabase auth mock -------------------------------------------------------
let mockedUserId: string | null;
let mockedEmail: string | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: mockedUserId
            ? { id: mockedUserId, email: mockedEmail ?? 'test@example.com' }
            : null,
        },
      }),
    },
  }),
}));

// ---- Dynamic imports (after mocks) -------------------------------------------
let acceptPost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST: acceptPost } = await import('@/app/api/skills/propose/accept/route'));
});

// ---- Test payload ------------------------------------------------------------

const PROPOSAL_INPUT = {
  name: 'agent-led-test-skill',
  description: 'A skill proposed by the agent in the integration test.',
  body: '## Agent Skill\n\nThis is the skill body written by the agent.',
  resources: [
    { relative_path: 'refs/example.md', content: 'Example reference content.' },
    { relative_path: 'refs/template.md', content: 'Template content.' },
  ],
  rationale: 'Testing the agent-led authoring path end-to-end.',
};

// ---- Test -------------------------------------------------------------------

it('agent calls propose_skill_create then accept route writes skill tree to DB', { timeout: 60_000 }, async () => {
  const { db } = await import('@/db');
  const { documents } = await import('@/db/schema/documents');
  const { and, eq, isNull } = await import('drizzle-orm');
  const { proposeSkillCreateTool } = await import('@/lib/tools/propose-skill-create');

  // ─── Part 1: Simulate agent calling propose_skill_create ─────────────────
  // Direct execute() call — no LLM involved. Mirrors how a unit test calls
  // the tool; here we layer it into the integration flow to assert the
  // proposal shape before the user approves.
  // execute() return type is TOutput | AsyncIterable<TOutput>; cast to the
  // concrete shape since this tool's execute is synchronous (returns plain object).
  type ProposalResult = {
    isProposal: boolean;
    proposal: {
      kind: 'skill-create';
      name: string;
      description: string;
      body: string;
      resources: { relative_path: string; content: string }[];
      rationale: string;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const toolResult = (await proposeSkillCreateTool.execute!(PROPOSAL_INPUT, {
    toolCallId: 'tc-integration-1',
    messages: [],
  } as never)) as ProposalResult;

  // Tool must signal that this is a proposal — the chat UI gates on this flag.
  expect(toolResult.isProposal).toBe(true);

  // Discriminator the card renderer switches on.
  expect(toolResult.proposal.kind).toBe('skill-create');

  // All input fields must pass through unchanged.
  expect(toolResult.proposal.name).toBe(PROPOSAL_INPUT.name);
  expect(toolResult.proposal.description).toBe(PROPOSAL_INPUT.description);
  expect(toolResult.proposal.body).toBe(PROPOSAL_INPUT.body);
  expect(toolResult.proposal.resources).toHaveLength(2);
  expect(toolResult.proposal.resources[0].relative_path).toBe('refs/example.md');
  expect(toolResult.proposal.resources[1].relative_path).toBe('refs/template.md');
  expect(toolResult.proposal.rationale).toBe(PROPOSAL_INPUT.rationale);

  // ─── Part 2: User approves — POST to accept route ────────────────────────
  // Set fixture user as authenticated before calling the route.
  mockedUserId = fixtures.ownerUserId;
  mockedEmail = fixtures.ownerEmail;

  // Accept payload is the proposal input minus `kind` (client sends raw fields).
  const acceptPayload = {
    name: PROPOSAL_INPUT.name,
    description: PROPOSAL_INPUT.description,
    body: PROPOSAL_INPUT.body,
    resources: PROPOSAL_INPUT.resources,
    rationale: PROPOSAL_INPUT.rationale,
  };

  const acceptRes = await acceptPost(
    new Request('http://localhost/api/skills/propose/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(acceptPayload),
    }),
  );

  expect(acceptRes.status).toBe(201);

  const acceptBody = (await acceptRes.json()) as { success: boolean; data: { skill_id: string } };
  expect(acceptBody.success).toBe(true);

  const skillId = acceptBody.data.skill_id;
  expect(skillId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  // ─── Part 3: Assert skill tree landed in DB ───────────────────────────────

  // Root skill document
  const [rootRow] = await db
    .select({
      id: documents.id,
      type: documents.type,
      title: documents.title,
      content: documents.content,
      brainId: documents.brainId,
    })
    .from(documents)
    .where(and(eq(documents.id, skillId), isNull(documents.deletedAt)))
    .limit(1);

  expect(rootRow).toBeDefined();
  expect(rootRow.type).toBe('skill');
  expect(rootRow.brainId).toBe(fixtures.brainId);
  expect(rootRow.title).toBe(PROPOSAL_INPUT.name);

  // Content must contain the name, description, and body passed in.
  expect(rootRow.content).toContain(PROPOSAL_INPUT.name);
  expect(rootRow.content).toContain(PROPOSAL_INPUT.description);
  expect(rootRow.content).toContain(PROPOSAL_INPUT.body);

  // Resource children
  const resourceRows = await db
    .select({
      id: documents.id,
      type: documents.type,
      relativePath: documents.relativePath,
      content: documents.content,
      parentSkillId: documents.parentSkillId,
    })
    .from(documents)
    .where(
      and(
        eq(documents.parentSkillId, skillId),
        isNull(documents.deletedAt),
      ),
    );

  expect(resourceRows).toHaveLength(2);

  const paths = resourceRows.map((r) => r.relativePath).sort();
  expect(paths).toEqual(['refs/example.md', 'refs/template.md']);

  for (const row of resourceRows) {
    expect(row.type).toBe('skill-resource');
    expect(row.parentSkillId).toBe(skillId);
  }

  // Verify individual resource content
  const exampleRow = resourceRows.find((r) => r.relativePath === 'refs/example.md');
  expect(exampleRow?.content).toContain('Example reference content.');

  const templateRow = resourceRows.find((r) => r.relativePath === 'refs/template.md');
  expect(templateRow?.content).toContain('Template content.');
});

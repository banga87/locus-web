/**
 * @vitest-environment node
 */
// End-to-end integration test for the full skill-import lifecycle:
//   install → preview-update → update → delete
//
// Mocking strategy:
//   - @/lib/skills/github-import: mock fetchSkillPreview (no live GitHub calls)
//     while keeping parseSkillUrl real.
//   - @/lib/supabase/server: mock auth so requireAuth resolves to the fixture user.
//   - @/lib/axiom/server: mock to avoid @axiomhq/nextjs / next/server resolution
//     issues under Node 22 + Next 16.
//   - Everything else (drizzle, route handlers, write-skill-tree, etc.) runs real.

import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';

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
  fixtures = await setupFixtures('skills-import-lifecycle');
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

// ---- github-import mock -------------------------------------------------------
// Keep parseSkillUrl real; mock only fetchSkillPreview so route handlers run
// end-to-end against the live DB.
vi.mock('@/lib/skills/github-import', async () => {
  const real = await vi.importActual('@/lib/skills/github-import') as typeof import('@/lib/skills/github-import');
  return {
    ...real,
    fetchSkillPreview: vi.fn(),
  };
});

// ---- Dynamic imports (after mocks) -------------------------------------------
import type { SkillPreview } from '@/lib/skills/github-import';
import { fetchSkillPreview } from '@/lib/skills/github-import';

const mockFetchSkillPreview = fetchSkillPreview as ReturnType<typeof vi.fn>;

// Route handlers — imported after mocks so they pick up mocked dependencies.
let importPreviewPost: (req: Request) => Promise<Response>;
let importPost: (req: Request) => Promise<Response>;
let updatePreviewPost: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let updatePost: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let deleteSkill: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

beforeAll(async () => {
  ({ POST: importPreviewPost } = await import('@/app/api/skills/import/preview/route'));
  ({ POST: importPost } = await import('@/app/api/skills/import/route'));
  ({ POST: updatePreviewPost } = await import('@/app/api/skills/[id]/update/preview/route'));
  ({ POST: updatePost } = await import('@/app/api/skills/[id]/update/route'));
  ({ DELETE: deleteSkill } = await import('@/app/api/skills/[id]/route'));
});

// ---- Helpers -----------------------------------------------------------------

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

afterEach(() => {
  mockFetchSkillPreview.mockReset();
  // Restore fixture user after any test that mutates these
  mockedUserId = fixtures.ownerUserId;
  mockedEmail = fixtures.ownerEmail;
});

// ---- Fixtures ---------------------------------------------------------------

const TEST_URL = 'https://skills.sh/acme/skills/test-skill';

const PREVIEW_V1: SkillPreview = {
  name: 'test-skill',
  description: 'a test',
  sha: 'sha-v1',
  skillMdBody: 'body v1',
  resources: [
    { relative_path: 'refs/a.md', content: 'a v1', bytes: 4 },
    { relative_path: 'refs/b.md', content: 'b v1', bytes: 4 },
  ],
  totalBytes: 16,
  warnings: [],
};

const PREVIEW_V2: SkillPreview = {
  name: 'test-skill',
  description: 'a test updated',
  sha: 'sha-v2',
  skillMdBody: 'body v2',
  resources: [
    { relative_path: 'refs/a.md', content: 'a v2', bytes: 4 },
    { relative_path: 'refs/c.md', content: 'c v2', bytes: 4 },
  ],
  totalBytes: 16,
  warnings: [],
};

// ---- Test -------------------------------------------------------------------

it('completes the full install → update → delete flow', { timeout: 60000 }, async () => {
  const { db } = await import('@/db');
  const { documents } = await import('@/db/schema/documents');
  const { and, eq, isNull, isNotNull } = await import('drizzle-orm');

  // Set fixture user as authenticated
  mockedUserId = fixtures.ownerUserId;
  mockedEmail = fixtures.ownerEmail;

  // ─── Step 1: /import/preview ──────────────────────────────────────────────
  mockFetchSkillPreview.mockResolvedValueOnce(PREVIEW_V1);

  const previewRes = await importPreviewPost(
    new Request('http://localhost/api/skills/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: TEST_URL }),
    }),
  );

  expect(previewRes.status).toBe(200);
  const previewBody = (await previewRes.json()) as { success: boolean; data: SkillPreview };
  expect(previewBody.success).toBe(true);
  expect(previewBody.data.name).toBe(PREVIEW_V1.name);
  expect(previewBody.data.sha).toBe(PREVIEW_V1.sha);
  expect(previewBody.data.description).toBe(PREVIEW_V1.description);
  expect(previewBody.data.resources).toHaveLength(2);

  // ─── Step 2: /import ──────────────────────────────────────────────────────
  mockFetchSkillPreview.mockResolvedValueOnce(PREVIEW_V1);

  const importRes = await importPost(
    new Request('http://localhost/api/skills/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: TEST_URL, confirmed_sha: 'sha-v1' }),
    }),
  );

  expect(importRes.status).toBe(201);
  const importBody = (await importRes.json()) as { success: boolean; data: { skill_id: string } };
  expect(importBody.success).toBe(true);
  const skillId = importBody.data.skill_id;
  expect(skillId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  // Assert root row
  const [rootRow] = await db
    .select({ id: documents.id, type: documents.type, title: documents.title, content: documents.content })
    .from(documents)
    .where(and(eq(documents.id, skillId), isNull(documents.deletedAt)))
    .limit(1);

  expect(rootRow).toBeDefined();
  expect(rootRow.type).toBe('skill');
  expect(rootRow.title).toBe('test-skill');

  // Parse frontmatter and assert source.sha
  const fmMatch1 = rootRow.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(fmMatch1).not.toBeNull();
  const fm1 = yaml.load(fmMatch1![1]) as Record<string, unknown>;
  const source1 = fm1.source as { sha: string; github: Record<string, unknown> };
  expect(source1.sha).toBe('sha-v1');
  expect(source1.github).toMatchObject({ owner: 'acme', repo: 'skills', skill: 'test-skill' });

  // Assert 2 resource children
  const resources1 = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.parentSkillId, skillId), isNull(documents.deletedAt)));

  expect(resources1).toHaveLength(2);

  // ─── Step 3: /update/preview ──────────────────────────────────────────────
  mockFetchSkillPreview.mockResolvedValueOnce(PREVIEW_V2);

  const updatePreviewRes = await updatePreviewPost(
    new Request(`http://localhost/api/skills/${skillId}/update/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
    makeCtx(skillId),
  );

  expect(updatePreviewRes.status).toBe(200);
  const updatePreviewBody = (await updatePreviewRes.json()) as {
    success: boolean;
    data: { up_to_date: boolean; current_sha: string; latest_sha: string; preview: SkillPreview };
  };
  expect(updatePreviewBody.success).toBe(true);
  expect(updatePreviewBody.data.up_to_date).toBe(false);
  expect(updatePreviewBody.data.current_sha).toBe('sha-v1');
  expect(updatePreviewBody.data.latest_sha).toBe('sha-v2');
  expect(updatePreviewBody.data.preview).toMatchObject({
    sha: 'sha-v2',
    name: PREVIEW_V2.name,
  });

  // ─── Step 4: /update ──────────────────────────────────────────────────────
  mockFetchSkillPreview.mockResolvedValueOnce(PREVIEW_V2);

  const updateRes = await updatePost(
    new Request(`http://localhost/api/skills/${skillId}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_sha: 'sha-v2' }),
    }),
    makeCtx(skillId),
  );

  expect(updateRes.status).toBe(200);
  const updateBody = (await updateRes.json()) as {
    success: boolean;
    data: { skill_id: string; new_sha: string };
  };
  expect(updateBody.success).toBe(true);
  expect(updateBody.data.skill_id).toBe(skillId);
  expect(updateBody.data.new_sha).toBe('sha-v2');

  // Assert root frontmatter updated to sha-v2
  const [rootRowV2] = await db
    .select({ content: documents.content, version: documents.version })
    .from(documents)
    .where(eq(documents.id, skillId))
    .limit(1);

  const fmMatch2 = rootRowV2.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(fmMatch2).not.toBeNull();
  const fm2 = yaml.load(fmMatch2![1]) as Record<string, unknown>;
  const source2 = fm2.source as { sha: string };
  expect(source2.sha).toBe('sha-v2');
  expect(rootRowV2.version).toBe(2);

  // Assert old resources gone, new v2 resources present (2 new resources)
  const resourcesV2 = await db
    .select({ id: documents.id, relativePath: documents.relativePath })
    .from(documents)
    .where(and(eq(documents.parentSkillId, skillId), isNull(documents.deletedAt)));

  expect(resourcesV2).toHaveLength(2);
  const paths = resourcesV2.map((r) => r.relativePath).sort();
  expect(paths).toEqual(['refs/a.md', 'refs/c.md']);

  // ─── Step 5: DELETE ───────────────────────────────────────────────────────
  const deleteRes = await deleteSkill(
    new Request(`http://localhost/api/skills/${skillId}`, {
      method: 'DELETE',
    }),
    makeCtx(skillId),
  );

  expect(deleteRes.status).toBe(200);
  const deleteBody = (await deleteRes.json()) as { success: boolean; data: { id: string } };
  expect(deleteBody.success).toBe(true);
  expect(deleteBody.data.id).toBe(skillId);

  // Assert root soft-deleted
  const [deletedRoot] = await db
    .select({ id: documents.id, deletedAt: documents.deletedAt })
    .from(documents)
    .where(eq(documents.id, skillId))
    .limit(1);

  expect(deletedRoot.deletedAt).not.toBeNull();

  // Assert both v2 children also soft-deleted
  const liveChildrenAfterDelete = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.parentSkillId, skillId), isNull(documents.deletedAt)));

  expect(liveChildrenAfterDelete).toHaveLength(0);

  // Confirm the children themselves have deletedAt set
  const allChildrenAfterDelete = await db
    .select({ id: documents.id, deletedAt: documents.deletedAt })
    .from(documents)
    .where(and(eq(documents.parentSkillId, skillId), isNotNull(documents.deletedAt)));

  expect(allChildrenAfterDelete).toHaveLength(2);
  for (const child of allChildrenAfterDelete) {
    expect(child.deletedAt).not.toBeNull();
  }

  // Confirm WHERE deletedAt IS NULL filters everything out
  const noRoots = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, skillId), isNull(documents.deletedAt)));

  expect(noRoots).toHaveLength(0);
});

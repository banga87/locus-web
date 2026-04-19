/**
 * @vitest-environment node
 */
// Integration tests for POST /api/skills/import
//
// DB writes are real — writeSkillTree calls drizzle directly. We use
// setupFixtures/teardownFixtures to create a real company + brain, then
// cascade-delete everything in teardown.
//
// Auth: supabase mock returns a fixture user; drizzle is left LIVE so
// requireAuth()'s db.select(users) resolves via the real users row that
// setupFixtures inserts.
//
// github-import: mocked so no live GitHub calls are made.

import { afterAll, beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import yaml from 'js-yaml';

import {
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from '@/lib/tools/__tests__/_fixtures';

// ---- Fixtures ----------------------------------------------------------------
let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await setupFixtures('skill-import');
});

afterAll(async () => {
  if (fixtures) await teardownFixtures(fixtures);
});

// ---- Supabase auth mock -------------------------------------------------------
// Controls whether getUser() returns a real user or null.
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

// NOTE: We do NOT mock @/db — drizzle stays live. The users row created by
// setupFixtures will be resolved by requireAuth()'s db.select(users) call.

// ---- github-import mock -------------------------------------------------------
vi.mock('@/lib/skills/github-import', () => ({
  parseSkillUrl: vi.fn(),
  fetchSkillPreview: vi.fn(),
}));

// ---- Dynamic import (after mocks) --------------------------------------------
import type { ParsedSkillUrl, SkillPreview } from '@/lib/skills/github-import';
import { parseSkillUrl, fetchSkillPreview } from '@/lib/skills/github-import';

const mockParseSkillUrl = parseSkillUrl as ReturnType<typeof vi.fn>;
const mockFetchSkillPreview = fetchSkillPreview as ReturnType<typeof vi.fn>;

let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/skills/import/route'));
});

// ---- Helpers -----------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/skills/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const fakeParsed: ParsedSkillUrl = {
  owner: 'acme',
  repo: 'skills',
  skillName: 'daily-digest',
};

function makeFakePreview(overrides?: Partial<SkillPreview>): SkillPreview {
  return {
    name: 'Daily Digest',
    description: 'Sends a daily digest of activity.',
    sha: 'abc123sha',
    skillMdBody: '## Daily Digest\n\nSends emails.',
    resources: [
      { relative_path: 'guide.md', content: '# Guide', bytes: 7 },
      { relative_path: 'ref.md', content: '# Ref', bytes: 5 },
    ],
    totalBytes: 500,
    warnings: [],
    ...overrides,
  };
}

const TEST_SHA = 'deadbeef1234567890abcdef';
const TEST_URL = 'https://skills.sh/acme/skills/daily-digest';

// ---- Tests -------------------------------------------------------------------

describe('POST /api/skills/import', () => {
  beforeAll(() => {
    // Default: use fixture owner user
    mockedUserId = fixtures.ownerUserId;
    mockedEmail = fixtures.ownerEmail;
  });

  afterEach(() => {
    // Restore defaults after tests that mutate them
    mockedUserId = fixtures.ownerUserId;
    mockedEmail = fixtures.ownerEmail;
    mockParseSkillUrl.mockReset();
    mockFetchSkillPreview.mockReset();
  });

  it('1. happy path — writes skill tree, returns 201 with skill_id', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockResolvedValueOnce(makeFakePreview());

    const req = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { skill_id: string } };
    expect(body.success).toBe(true);
    expect(body.data.skill_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('2. pinSha is forwarded — fetchSkillPreview called with { pinSha: confirmed_sha }', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockResolvedValueOnce(makeFakePreview({ name: 'Pin Test Skill' }));

    const req = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    await POST(req);

    expect(mockFetchSkillPreview).toHaveBeenCalledOnce();
    expect(mockFetchSkillPreview.mock.calls[0][1]).toEqual({ pinSha: TEST_SHA });
  });

  it('3. source block on root — sha, imported_at, and github fields are correct', async () => {
    const { db } = await import('@/db');
    const { documents } = await import('@/db/schema/documents');
    const { eq } = await import('drizzle-orm');

    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockResolvedValueOnce(makeFakePreview({ name: 'Source Block Skill' }));

    const req = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { skill_id: string } };

    const [rootRow] = await db
      .select({ content: documents.content })
      .from(documents)
      .where(eq(documents.id, data.skill_id))
      .limit(1);

    expect(rootRow).toBeDefined();

    // Parse frontmatter from root content
    const match = rootRow.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(match).not.toBeNull();

    const fm = yaml.load(match![1]) as Record<string, unknown>;
    const source = fm.source as {
      sha: string;
      imported_at: string;
      github: { owner: string; repo: string; skill: string | null };
    };

    expect(source.sha).toBe(TEST_SHA);
    expect(source.imported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(source.github).toMatchObject({
      owner: 'acme',
      repo: 'skills',
      skill: 'daily-digest',
    });
  });

  it('4. DB row count — 1 root (type=skill) + 2 resource rows (type=skill-resource)', async () => {
    const { db } = await import('@/db');
    const { documents } = await import('@/db/schema/documents');
    const { and, eq } = await import('drizzle-orm');

    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockResolvedValueOnce(makeFakePreview({ name: 'Row Count Skill' }));

    const req = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { skill_id: string } };

    const [rootRow] = await db
      .select({ id: documents.id, type: documents.type, title: documents.title })
      .from(documents)
      .where(and(eq(documents.id, data.skill_id)))
      .limit(1);

    expect(rootRow.type).toBe('skill');
    expect(rootRow.title).toBe('Row Count Skill');

    const resourceRows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.parentSkillId, data.skill_id));

    expect(resourceRows).toHaveLength(2);
  });

  it('5. GitHub 404 at confirmed_sha — returns 409 sha_not_found', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockRejectedValueOnce(
      new Error('GitHub returned 404: https://raw.githubusercontent.com/acme/skills/deadbeef/SKILL.md'),
    );

    const req = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('sha_not_found');
    expect(body.error.message).toContain('re-preview');
  });

  it('6. duplicate install — second call returns 409 slug_taken', async () => {
    mockParseSkillUrl.mockReturnValue(fakeParsed);
    mockFetchSkillPreview.mockResolvedValue(makeFakePreview({ name: 'Duplicate Slug Skill' }));

    const req1 = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    const res1 = await POST(req1);
    expect(res1.status).toBe(201);

    const req2 = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    const res2 = await POST(req2);

    expect(res2.status).toBe(409);
    const body = (await res2.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('slug_taken');
    expect(body.error.message).toContain('Duplicate Slug Skill');
  });

  it('7. empty description — returns 422 empty_description', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockRejectedValueOnce(
      new Error("the skill's description is empty. Agents won't know when to use it."),
    );

    const req = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    const res = await POST(req);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('empty_description');
  });

  it('8. unauthenticated — supabase returns null user → 401', async () => {
    mockedUserId = null;

    const req = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthenticated');
  });

  it('9. no companyId — user profile has no company → 403 no_company', async () => {
    // Use a user that exists in supabase auth but has no companyId in their profile.
    // We create a separate user in the DB with companyId=null to simulate this.
    const { db } = await import('@/db');
    const { users } = await import('@/db/schema/users');
    const { randomUUID } = await import('node:crypto');

    const noCompanyUserId = randomUUID();
    const noCompanyEmail = `no-company-${Date.now()}@example.test`;

    await db.insert(users).values({
      id: noCompanyUserId,
      companyId: null,
      fullName: 'No Company User',
      email: noCompanyEmail,
      status: 'active',
    });

    mockedUserId = noCompanyUserId;
    mockedEmail = noCompanyEmail;

    const req = makeRequest({ url: TEST_URL, confirmed_sha: TEST_SHA });
    const res = await POST(req);

    // Cleanup
    await db.delete(users).where((await import('drizzle-orm')).eq(users.id, noCompanyUserId));

    mockedUserId = fixtures.ownerUserId;
    mockedEmail = fixtures.ownerEmail;

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('no_company');
  });
});

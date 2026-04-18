/**
 * @vitest-environment node
 */
// Integration tests for POST /api/skills/[id]/update/preview
//
// Auth: supabase mock returns fixture user. DB stays live so requireAuth()'s
// db.select(users) resolves against the real users row from setupFixtures.
//
// github-import: mocked so no live GitHub calls are made.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from '@/lib/tools/__tests__/_fixtures';
import { writeSkillTree } from '@/lib/skills/write-skill-tree';

// ---- Fixtures ----------------------------------------------------------------
let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await setupFixtures('skill-update-preview');
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
vi.mock('@/lib/skills/github-import', () => ({
  parseSkillUrl: vi.fn(),
  fetchSkillPreview: vi.fn(),
}));

// ---- Dynamic import (after mocks) --------------------------------------------
import type { SkillPreview } from '@/lib/skills/github-import';
import { fetchSkillPreview } from '@/lib/skills/github-import';

const mockFetchSkillPreview = fetchSkillPreview as ReturnType<typeof vi.fn>;

let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/skills/[id]/update/preview/route'));
});

// ---- Helpers -----------------------------------------------------------------

function makeRequest(id: string): Request {
  return new Request(`http://localhost/api/skills/${id}/update/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeFakePreview(sha: string, overrides?: Partial<SkillPreview>): SkillPreview {
  return {
    name: 'Daily Digest',
    description: 'Sends a daily digest of activity.',
    sha,
    skillMdBody: '## Daily Digest\n\nSends emails.',
    resources: [
      { relative_path: 'guide.md', content: '# Guide', bytes: 7 },
    ],
    totalBytes: 500,
    warnings: [],
    ...overrides,
  };
}

const CURRENT_SHA = 'current-sha-abc123';
const LATEST_SHA = 'latest-sha-xyz789';

// Seed a skill with a source block (installed skill)
async function seedInstalledSkill(sha: string = CURRENT_SHA): Promise<string> {
  const result = await writeSkillTree({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    name: `Update Preview Skill ${Date.now()}`,
    description: 'Test skill for update preview',
    skillMdBody: '## Test Skill\n\nBody.',
    resources: [
      { relative_path: 'ref.md', content: '# Ref' },
    ],
    source: {
      github: {
        owner: 'acme',
        repo: 'skills',
        skill: 'daily-digest',
      },
      sha,
      imported_at: new Date().toISOString(),
    },
  });
  return result.rootId;
}

// Seed an authored skill (no source block)
async function seedAuthoredSkill(): Promise<string> {
  const result = await writeSkillTree({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    name: `Authored Skill ${Date.now()}`,
    description: 'A hand-authored skill',
    skillMdBody: '## Authored\n\nBody.',
    resources: [],
  });
  return result.rootId;
}

// ---- Tests -------------------------------------------------------------------

describe('POST /api/skills/[id]/update/preview', () => {
  beforeAll(() => {
    mockedUserId = fixtures.ownerUserId;
    mockedEmail = fixtures.ownerEmail;
  });

  afterEach(() => {
    mockedUserId = fixtures.ownerUserId;
    mockedEmail = fixtures.ownerEmail;
    mockFetchSkillPreview.mockReset();
  });

  it('1. up_to_date — SHA unchanged, returns { up_to_date: true, current_sha }', async () => {
    const skillId = await seedInstalledSkill(CURRENT_SHA);
    mockFetchSkillPreview.mockResolvedValueOnce(makeFakePreview(CURRENT_SHA));

    const res = await POST(makeRequest(skillId), makeCtx(skillId));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.up_to_date).toBe(true);
    expect(body.data.current_sha).toBe(CURRENT_SHA);
    expect(body.data.latest_sha).toBeUndefined();
    expect(body.data.preview).toBeUndefined();
  });

  it('2. new upstream sha — returns { up_to_date: false, current_sha, latest_sha, preview }', async () => {
    const skillId = await seedInstalledSkill(CURRENT_SHA);
    const fakePreview = makeFakePreview(LATEST_SHA);
    mockFetchSkillPreview.mockResolvedValueOnce(fakePreview);

    const res = await POST(makeRequest(skillId), makeCtx(skillId));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.up_to_date).toBe(false);
    expect(body.data.current_sha).toBe(CURRENT_SHA);
    expect(body.data.latest_sha).toBe(LATEST_SHA);
    expect(body.data.preview).toBeDefined();
    expect((body.data.preview as Record<string, unknown>).sha).toBe(LATEST_SHA);
  });

  it('3. non-install — authored skill → 400 not_an_install', async () => {
    const skillId = await seedAuthoredSkill();

    const res = await POST(makeRequest(skillId), makeCtx(skillId));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_an_install');
  });

  it('4. skill not found — random UUID → 404', async () => {
    const res = await POST(makeRequest(randomUUID()), makeCtx(randomUUID()));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('5. rate limited — fetchSkillPreview throws rate limit error → 429', async () => {
    const skillId = await seedInstalledSkill(CURRENT_SHA);
    mockFetchSkillPreview.mockRejectedValueOnce(
      new Error('GitHub API rate limit exceeded, resets at 1999999999'),
    );

    const res = await POST(makeRequest(skillId), makeCtx(skillId));

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('6. unauthenticated — supabase returns null user → 401', async () => {
    mockedUserId = null;

    const res = await POST(makeRequest(randomUUID()), makeCtx(randomUUID()));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthenticated');
  });
});

/**
 * @vitest-environment node
 */
// Integration tests for POST /api/skills/[id]/update
//
// Auth: supabase mock returns fixture user. DB stays live.
// github-import: mocked so no live GitHub calls are made.
// replaceSkillResources: called for real — asserts actual DB state after update.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';

import {
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from '@/lib/tools/__tests__/_fixtures';
import { writeSkillTree } from '@/lib/skills/write-skill-tree';

// ---- Fixtures ----------------------------------------------------------------
let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await setupFixtures('skill-update');
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
  ({ POST } = await import('@/app/api/skills/[id]/update/route'));
});

// ---- Helpers -----------------------------------------------------------------

function makeRequest(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/skills/${id}/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeFakePreview(sha: string, resources: Array<{ relative_path: string; content: string; bytes: number }> = []): SkillPreview {
  return {
    name: 'Daily Digest',
    description: 'Sends a daily digest of activity.',
    sha,
    skillMdBody: '## Daily Digest\n\nSends emails.',
    resources,
    totalBytes: 500,
    warnings: [],
  };
}

const CURRENT_SHA = 'current-sha-abc123';
const TARGET_SHA = 'target-sha-xyz789';

async function seedInstalledSkill(resourceCount = 2): Promise<string> {
  const resources = Array.from({ length: resourceCount }, (_, i) => ({
    relative_path: `resource-${i}.md`,
    content: `# Resource ${i}`,
  }));
  const result = await writeSkillTree({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    name: `Update Skill ${Date.now()}`,
    description: 'Test skill for update',
    skillMdBody: '## Original\n\nBody.',
    resources,
    source: {
      github: { owner: 'acme', repo: 'skills', skill: 'daily-digest' },
      sha: CURRENT_SHA,
      imported_at: new Date().toISOString(),
    },
  });
  return result.rootId;
}

async function seedAuthoredSkill(): Promise<string> {
  const result = await writeSkillTree({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    name: `Authored Skill Update ${Date.now()}`,
    description: 'A hand-authored skill',
    skillMdBody: '## Authored\n\nBody.',
    resources: [],
  });
  return result.rootId;
}

// ---- Tests -------------------------------------------------------------------

describe('POST /api/skills/[id]/update', () => {
  beforeAll(() => {
    mockedUserId = fixtures.ownerUserId;
    mockedEmail = fixtures.ownerEmail;
  });

  afterEach(() => {
    mockedUserId = fixtures.ownerUserId;
    mockedEmail = fixtures.ownerEmail;
    mockFetchSkillPreview.mockReset();
  });

  it('1. happy path — replaces resources, bumps sha in frontmatter', { timeout: 15000 }, async () => {
    const { db } = await import('@/db');
    const { documents } = await import('@/db/schema/documents');
    const { and, eq, isNull } = await import('drizzle-orm');

    const skillId = await seedInstalledSkill(2);

    const newResources = [
      { relative_path: 'new-a.md', content: '# New A', bytes: 7 },
      { relative_path: 'new-b.md', content: '# New B', bytes: 7 },
      { relative_path: 'new-c.md', content: '# New C', bytes: 7 },
    ];
    mockFetchSkillPreview.mockResolvedValueOnce(makeFakePreview(TARGET_SHA, newResources));

    const res = await POST(makeRequest(skillId, { target_sha: TARGET_SHA }), makeCtx(skillId));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { skill_id: string; new_sha: string } };
    expect(body.success).toBe(true);
    expect(body.data.skill_id).toBe(skillId);
    expect(body.data.new_sha).toBe(TARGET_SHA);

    // Verify DB: root frontmatter has new sha
    const [rootRow] = await db
      .select({ content: documents.content })
      .from(documents)
      .where(eq(documents.id, skillId))
      .limit(1);

    const match = rootRow.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(match).not.toBeNull();
    const fm = yaml.load(match![1]) as Record<string, unknown>;
    const source = fm.source as Record<string, unknown>;
    expect(source.sha).toBe(TARGET_SHA);

    // Verify DB: exactly 3 new resource children (old 2 replaced)
    const resourceRows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.parentSkillId, skillId),
          isNull(documents.deletedAt),
        ),
      );
    expect(resourceRows).toHaveLength(3);
  });

  it('2. non-install — authored skill → 400 not_an_install', async () => {
    const skillId = await seedAuthoredSkill();

    const res = await POST(makeRequest(skillId, { target_sha: TARGET_SHA }), makeCtx(skillId));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_an_install');
  });

  it('3. pinned sha 404 — fetchSkillPreview throws GitHub 404 → 409 sha_not_found', async () => {
    const skillId = await seedInstalledSkill(1);
    mockFetchSkillPreview.mockRejectedValueOnce(
      new Error('GitHub returned 404: https://raw.githubusercontent.com/acme/skills/badsha/SKILL.md'),
    );

    const res = await POST(makeRequest(skillId, { target_sha: 'bad-sha' }), makeCtx(skillId));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('sha_not_found');
  });

  it('4. skill not found — random UUID → 404', async () => {
    const fakeId = randomUUID();
    const res = await POST(makeRequest(fakeId, { target_sha: TARGET_SHA }), makeCtx(fakeId));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('5. unauthenticated — supabase returns null user → 401', async () => {
    mockedUserId = null;
    const fakeId = randomUUID();
    const res = await POST(makeRequest(fakeId, { target_sha: TARGET_SHA }), makeCtx(fakeId));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthenticated');
  });
});

/**
 * @vitest-environment node
 */
// Integration tests for DELETE /api/skills/[id]
//
// Auth: supabase mock returns fixture user. DB stays live.
// Soft-delete semantics: root + children get deletedAt set; second call → 404.

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
let otherFixtures: Fixtures;

beforeAll(async () => {
  fixtures = await setupFixtures('skill-delete');
  otherFixtures = await setupFixtures('skill-delete-other');
});

afterAll(async () => {
  if (fixtures) await teardownFixtures(fixtures);
  if (otherFixtures) await teardownFixtures(otherFixtures);
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

// ---- Dynamic import (after mocks) --------------------------------------------
let DELETE_HANDLER: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

beforeAll(async () => {
  ({ DELETE: DELETE_HANDLER } = await import('@/app/api/skills/[id]/route'));
});

// ---- Helpers -----------------------------------------------------------------

function makeRequest(id: string): Request {
  return new Request(`http://localhost/api/skills/${id}`, {
    method: 'DELETE',
  });
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedSkill(fixtureSet: Fixtures, resourceCount = 2): Promise<string> {
  const resources = Array.from({ length: resourceCount }, (_, i) => ({
    relative_path: `res-${i}.md`,
    content: `# Resource ${i}`,
  }));
  const result = await writeSkillTree({
    companyId: fixtureSet.companyId,
    brainId: fixtureSet.brainId,
    name: `Delete Test Skill ${Date.now()}-${Math.random()}`,
    description: 'Skill for delete test',
    skillMdBody: '## Test\n\nBody.',
    resources,
    source: {
      github: { owner: 'acme', repo: 'skills', skill: 'test' },
      sha: 'sha-abc',
      imported_at: new Date().toISOString(),
    },
  });
  return result.rootId;
}

// ---- Tests -------------------------------------------------------------------

describe('DELETE /api/skills/[id]', () => {
  beforeAll(() => {
    mockedUserId = fixtures.ownerUserId;
    mockedEmail = fixtures.ownerEmail;
  });

  afterEach(() => {
    mockedUserId = fixtures.ownerUserId;
    mockedEmail = fixtures.ownerEmail;
  });

  it('1. happy path — soft-deletes root + children, returns { id }', async () => {
    const { db } = await import('@/db');
    const { documents } = await import('@/db/schema/documents');
    const { eq, isNotNull } = await import('drizzle-orm');

    const skillId = await seedSkill(fixtures, 2);

    const res = await DELETE_HANDLER(makeRequest(skillId), makeCtx(skillId));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(skillId);

    // Root should have deletedAt set
    const [rootRow] = await db
      .select({ deletedAt: documents.deletedAt })
      .from(documents)
      .where(eq(documents.id, skillId))
      .limit(1);
    expect(rootRow.deletedAt).not.toBeNull();

    // All children should have deletedAt set
    const children = await db
      .select({ id: documents.id, deletedAt: documents.deletedAt })
      .from(documents)
      .where(eq(documents.parentSkillId, skillId));
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.deletedAt).not.toBeNull();
    }
  });

  it('2. skill not found — random UUID → 404', async () => {
    const fakeId = randomUUID();
    const res = await DELETE_HANDLER(makeRequest(fakeId), makeCtx(fakeId));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('3. already-deleted — second DELETE on same id → 404', async () => {
    const skillId = await seedSkill(fixtures, 1);

    const first = await DELETE_HANDLER(makeRequest(skillId), makeCtx(skillId));
    expect(first.status).toBe(200);

    const second = await DELETE_HANDLER(makeRequest(skillId), makeCtx(skillId));
    expect(second.status).toBe(404);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('4. cross-company isolation — cannot delete another company\'s skill → 404', async () => {
    // Seed a skill in otherFixtures' company
    const otherSkillId = await seedSkill(otherFixtures, 1);

    // Call DELETE authenticated as fixtures user (different company)
    const res = await DELETE_HANDLER(makeRequest(otherSkillId), makeCtx(otherSkillId));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });

  it('5. unauthenticated — supabase returns null user → 401', async () => {
    mockedUserId = null;
    const fakeId = randomUUID();
    const res = await DELETE_HANDLER(makeRequest(fakeId), makeCtx(fakeId));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthenticated');
  });
});

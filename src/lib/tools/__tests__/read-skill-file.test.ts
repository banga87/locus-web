import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { randomUUID } from 'node:crypto';

import { readSkillFileTool } from '../implementations/read-skill-file';
import { deriveResourceSlug, deriveResourcePath } from '@/lib/skills/resource-slug';
import type { ToolContext } from '../types';

import { setupFixtures, teardownFixtures, type Fixtures } from './_fixtures';

let fixtures: Fixtures;
let skillId: string;

beforeAll(async () => {
  fixtures = await setupFixtures('readskill');

  const [skillRow] = await db.insert(documents).values({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    title: 'Test Skill',
    slug: `test-skill-${fixtures.suffix}`,
    path: `skills/test-skill-${fixtures.suffix}`,
    content: `---\ntype: skill\nname: Test\ndescription: t.\n---\n\nBody`,
    type: 'skill',
    status: 'active',
  }).returning({ id: documents.id });
  skillId = skillRow.id;

  // Insert two resources under the skill.
  for (const rel of ['refs/a.md', 'refs/b.md']) {
    const rid = randomUUID();
    await db.insert(documents).values({
      id: rid,
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      title: rel,
      slug: deriveResourceSlug(rid),
      path: deriveResourcePath(`test-skill-${fixtures.suffix}`, rel),
      content: `Content of ${rel}`,
      type: 'skill-resource',
      parentSkillId: skillId,
      relativePath: rel,
      status: 'active',
    });
  }
});

afterAll(async () => teardownFixtures(fixtures));

function ctx(partial: Partial<ToolContext>): ToolContext {
  return { ...fixtures.context, ...partial };
}

describe('read_skill_file', () => {
  it('returns file content on hit', async () => {
    const result = await readSkillFileTool.call(
      { skill_id: skillId, relative_path: 'refs/a.md' },
      ctx({ agentSkillIds: [skillId] }),
    );
    expect(result.success).toBe(true);
    expect(result.data?.content).toBe('Content of refs/a.md');
  });

  it('returns unavailable when skill not in agentSkillIds', async () => {
    const result = await readSkillFileTool.call(
      { skill_id: skillId, relative_path: 'refs/a.md' },
      ctx({ agentSkillIds: [] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('unavailable');
  });

  it('returns path_not_found with sorted suggestions on miss', async () => {
    const result = await readSkillFileTool.call(
      { skill_id: skillId, relative_path: 'refs/missing.md' },
      ctx({ agentSkillIds: [skillId] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('path_not_found');
    expect(result.error?.suggestions).toEqual(['refs/a.md', 'refs/b.md']);
  });
});

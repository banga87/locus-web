import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { randomUUID } from 'node:crypto';

import { loadSkillTool } from '../implementations/load-skill';
import { deriveResourceSlug, deriveResourcePath } from '@/lib/skills/resource-slug';
import type { ToolContext } from '../types';

import { setupFixtures, teardownFixtures, type Fixtures } from './_fixtures';

let fixtures: Fixtures;
let skillId: string;
let brainDocId: string;

const SKILL_BODY = `---\ntype: skill\nname: Test Skill\ndescription: For tests.\n---\n\n# Test Skill\n\nInstructions here.`;

beforeAll(async () => {
  fixtures = await setupFixtures('loadskill');

  // Skill root
  const [skillRow] = await db.insert(documents).values({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    title: 'Test Skill',
    slug: `test-skill-${fixtures.suffix}`,
    path: `skills/test-skill-${fixtures.suffix}`,
    content: SKILL_BODY,
    type: 'skill',
    status: 'active',
  }).returning({ id: documents.id });
  skillId = skillRow.id;

  // Skill resource
  const resourceId = randomUUID();
  await db.insert(documents).values({
    id: resourceId,
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    title: 'refs/a.md',
    slug: deriveResourceSlug(resourceId),
    path: deriveResourcePath(`test-skill-${fixtures.suffix}`, 'refs/a.md'),
    content: 'Reference A content',
    type: 'skill-resource',
    parentSkillId: skillId,
    relativePath: 'refs/a.md',
    status: 'active',
  });

  // A brain doc (not a skill) — for the `not_a_skill` case.
  const [brainDoc] = await db.insert(documents).values({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    folderId: fixtures.folderBrandId,
    title: 'Plain brain doc',
    slug: `plain-${fixtures.suffix}`,
    path: `brand/plain-${fixtures.suffix}`,
    content: '# Plain',
    status: 'active',
  }).returning({ id: documents.id });
  brainDocId = brainDoc.id;
});

afterAll(async () => {
  await teardownFixtures(fixtures);
});

function ctx(partial: Partial<ToolContext>): ToolContext {
  return { ...fixtures.context, ...partial };
}

describe('load_skill', () => {
  it('returns body + resource paths for an allowed skill', async () => {
    const result = await loadSkillTool.call(
      { skill_id: skillId },
      ctx({ agentSkillIds: [skillId] }),
    );
    expect(result.success).toBe(true);
    expect(result.data?.body).toContain('# Test Skill');
    expect(result.data?.body).not.toMatch(/^---\n/);  // frontmatter stripped
    expect(result.data?.files).toEqual(['refs/a.md']);
  });

  it('returns unavailable when skill is not in agentSkillIds', async () => {
    const result = await loadSkillTool.call(
      { skill_id: skillId },
      ctx({ agentSkillIds: [] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('unavailable');
  });

  it('returns not_found for a missing id', async () => {
    const bogus = '00000000-0000-0000-0000-000000000000';
    const result = await loadSkillTool.call(
      { skill_id: bogus },
      ctx({ agentSkillIds: [bogus] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('not_found');
  });

  it('returns not_a_skill when id exists but is a brain doc', async () => {
    const result = await loadSkillTool.call(
      { skill_id: brainDocId },
      ctx({ agentSkillIds: [brainDocId] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('not_a_skill');
  });
});

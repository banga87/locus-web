// Integration tests for writeSkillTree and replaceSkillResources.
//
// These tests exercise the full DB round-trip against a live Supabase
// instance (same pattern as the other tool tests that use setupFixtures).
// Each test suite creates its own isolated company/brain via setupFixtures
// so suites can run in parallel without slug collisions.

import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import { eq, and, isNull, count } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import {
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from '@/lib/tools/__tests__/_fixtures';

import {
  writeSkillTree,
  replaceSkillResources,
  createResource,
  updateResource,
  deleteResource,
} from './write-skill-tree';
import { deriveResourceSlug, deriveResourcePath } from './resource-slug';

// ---------------------------------------------------------------------------
// writeSkillTree
// ---------------------------------------------------------------------------

describe('writeSkillTree', () => {
  let f: Fixtures;

  beforeEach(async () => {
    f = await setupFixtures('write-skill-tree');
  });

  afterEach(async () => {
    await teardownFixtures(f);
  });

  // -------------------------------------------------------------------------
  // Test 1: authored (no source) — 1 root + 2 resources
  // -------------------------------------------------------------------------
  it('authored (no source): inserts root + 2 resources with correct shapes', async () => {
    const { rootId, resourceIds } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'My Cool Skill',
      description: 'Helps agents do cool things.',
      skillMdBody: '# My Cool Skill\n\nMain body.',
      resources: [
        { relative_path: 'guide.md', content: '# Guide\nContent A.' },
        { relative_path: 'references/interview.md', content: '# Interview\nContent B.' },
      ],
    });

    expect(rootId).toBeTruthy();
    expect(resourceIds).toHaveLength(2);

    // --- root assertions ---
    const [root] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, rootId));

    expect(root.type).toBe('skill');
    expect(root.title).toBe('My Cool Skill');
    expect(root.slug).toBe('my-cool-skill');
    expect(root.path).toBe('skills/my-cool-skill');
    expect(root.companyId).toBe(f.companyId);
    expect(root.brainId).toBe(f.brainId);
    expect(root.folderId).toBeNull();
    expect(root.ownerId).toBeNull();
    expect(root.status).toBe('active');
    expect(root.confidenceLevel).toBe('medium');
    expect(root.isCore).toBe(false);
    expect(root.parentSkillId).toBeNull();
    expect(root.relativePath).toBeNull();
    expect(root.version).toBe(1);
    expect(root.summary).toBeNull();

    // Frontmatter has no `source:` key; body is appended after frontmatter
    const fm = yaml.load(
      root.content.slice(4, root.content.indexOf('\n---\n', 4)),
    ) as Record<string, unknown>;
    expect(fm.type).toBe('skill');
    expect(fm.name).toBe('My Cool Skill');
    expect(fm.description).toBe('Helps agents do cool things.');
    expect(fm.source).toBeUndefined();
    expect(root.content).toContain('# My Cool Skill');

    // --- resource assertions ---
    const resources = await db
      .select()
      .from(documents)
      .where(eq(documents.parentSkillId, rootId));

    expect(resources).toHaveLength(2);

    for (const res of resources) {
      expect(res.type).toBe('skill-resource');
      expect(res.parentSkillId).toBe(rootId);
      expect(res.companyId).toBe(f.companyId);
      expect(res.brainId).toBe(f.brainId);
      expect(res.folderId).toBeNull();
      expect(res.ownerId).toBeNull();
      expect(res.status).toBe('active');
      expect(res.confidenceLevel).toBe('medium');
      expect(res.isCore).toBe(false);
      expect(res.version).toBe(1);
      expect(res.summary).toBeNull();

      // slug derived from own id
      expect(res.slug).toBe(deriveResourceSlug(res.id));

      // path derived from parent slug + relative_path
      expect(res.path).toBe(
        deriveResourcePath('my-cool-skill', res.relativePath!),
      );
    }

    const relativePaths = resources.map((r) => r.relativePath).sort();
    expect(relativePaths).toEqual(['guide.md', 'references/interview.md'].sort());

    // title = filename without extension
    const guideRow = resources.find((r) => r.relativePath === 'guide.md')!;
    expect(guideRow.title).toBe('guide');

    const interviewRow = resources.find(
      (r) => r.relativePath === 'references/interview.md',
    )!;
    expect(interviewRow.title).toBe('interview');
  });

  // -------------------------------------------------------------------------
  // Test 2: imported (with source) — frontmatter includes source block
  // -------------------------------------------------------------------------
  it('imported (with source): root frontmatter contains full source object', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Skill With Source',
      description: 'An imported skill.',
      skillMdBody: '# Body',
      resources: [{ relative_path: 'ref.md', content: '# Ref' }],
      source: {
        github: { owner: 'acme-org', repo: 'skills', skill: 'skill-creator' },
        sha: 'deadbeef1234',
        imported_at: '2026-04-19T12:00:00.000Z',
      },
    });

    const [root] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, rootId));

    // Parse with js-yaml to get nested source block
    const fmBlock = root.content.slice(4, root.content.indexOf('\n---\n', 4));
    const fm = yaml.load(fmBlock) as Record<string, unknown>;

    expect(fm.type).toBe('skill');
    expect(fm.name).toBe('Skill With Source');
    expect(fm.description).toBe('An imported skill.');

    const source = fm.source as Record<string, unknown>;
    expect(source).toBeDefined();
    expect(source.sha).toBe('deadbeef1234');
    expect(source.imported_at).toBe('2026-04-19T12:00:00.000Z');

    const github = source.github as Record<string, unknown>;
    expect(github.owner).toBe('acme-org');
    expect(github.repo).toBe('skills');
    expect(github.skill).toBe('skill-creator');
  });

  // -------------------------------------------------------------------------
  // Test 3: zero resources — inserts root only
  // -------------------------------------------------------------------------
  it('zero resources: inserts only root, returns empty resourceIds', async () => {
    const { rootId, resourceIds } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Empty Skill',
      description: 'No resource files.',
      skillMdBody: '# Just the root.',
      resources: [],
    });

    expect(rootId).toBeTruthy();
    expect(resourceIds).toEqual([]);

    const children = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.parentSkillId, rootId));

    expect(children).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test: empty slug guard — name that slugifies to '' throws a clear error
  // -------------------------------------------------------------------------
  it('throws a clear error when skill name produces an empty slug', async () => {
    await expect(
      writeSkillTree({
        companyId: f.companyId,
        brainId: f.brainId,
        name: '!!!',
        description: 'Bad name.',
        skillMdBody: '# body',
        resources: [],
      }),
    ).rejects.toThrow('skill name "!!!" produces an empty slug');
  });

  // -------------------------------------------------------------------------
  // Test 4: transaction atomicity — duplicate relative_path fails the whole tx
  // -------------------------------------------------------------------------
  it('rolls back entirely when a resource insert violates the unique index', async () => {
    // The partial unique index `documents_skill_resource_path` rejects
    // two rows with the same (parent_skill_id, relative_path). We
    // provoke that by passing two resources with identical relative_path.
    await expect(
      writeSkillTree({
        companyId: f.companyId,
        brainId: f.brainId,
        name: 'Atomicity Test Skill',
        description: 'Should roll back.',
        skillMdBody: '# Root',
        resources: [
          { relative_path: 'dup.md', content: 'first' },
          { relative_path: 'dup.md', content: 'second' },
        ],
      }),
    ).rejects.toThrow();

    // Root must also be absent — the whole transaction rolled back.
    const [row] = await db
      .select({ ct: count() })
      .from(documents)
      .where(
        and(
          eq(documents.brainId, f.brainId),
          eq(documents.type, 'skill'),
          isNull(documents.deletedAt),
        ),
      );

    expect(Number(row.ct)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// replaceSkillResources
// ---------------------------------------------------------------------------

describe('replaceSkillResources', () => {
  let f: Fixtures;

  beforeEach(async () => {
    f = await setupFixtures('replace-skill-resources');
  });

  afterEach(async () => {
    await teardownFixtures(f);
  });

  // -------------------------------------------------------------------------
  // Test 5: replaceSkillResources — old resources gone, root updated
  // -------------------------------------------------------------------------
  it('replaces children and updates root sha/version/content', async () => {
    // Seed an initial imported tree
    const { rootId, resourceIds: initialIds } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Replace Me',
      description: 'Will be updated.',
      skillMdBody: '# Old body',
      resources: [
        { relative_path: 'old-a.md', content: '# Old A' },
        { relative_path: 'old-b.md', content: '# Old B' },
      ],
      source: {
        github: { owner: 'acme', repo: 'skills', skill: 'replace-me' },
        sha: 'oldshaaaaaa',
        imported_at: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(initialIds).toHaveLength(2);

    // --- replace ---
    const { resourceIds: newIds } = await replaceSkillResources({
      rootId,
      newSha: 'newshaaaaaa',
      newSkillMdBody: '# New body',
      newResources: [
        { relative_path: 'new-x.md', content: '# New X' },
      ],
    });

    expect(newIds).toHaveLength(1);

    // Old resource rows must be gone
    const oldChildren = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.parentSkillId, rootId),
          // Old ids check
        ),
      );
    // All children should now be only the new one
    expect(oldChildren).toHaveLength(1);
    expect(oldChildren[0].id).toBe(newIds[0]);

    // Root version bumped
    const [root] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, rootId));

    expect(root.version).toBe(2);

    // Root frontmatter: new sha, new imported_at, github sub-block unchanged
    const fmBlock = root.content.slice(4, root.content.indexOf('\n---\n', 4));
    const fm = yaml.load(fmBlock) as Record<string, unknown>;

    expect(fm.name).toBe('Replace Me');

    const source = fm.source as Record<string, unknown>;
    expect(source.sha).toBe('newshaaaaaa');

    // imported_at should be a recent ISO string (not the original)
    const importedAt = source.imported_at as string;
    expect(importedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(new Date(importedAt).getFullYear()).toBeGreaterThanOrEqual(2026);

    // github sub-block must be preserved unchanged
    const github = source.github as Record<string, unknown>;
    expect(github.owner).toBe('acme');
    expect(github.repo).toBe('skills');
    expect(github.skill).toBe('replace-me');

    // Body updated
    expect(root.content).toContain('# New body');
  });

  // -------------------------------------------------------------------------
  // Test 6: replaceSkillResources — unknown rootId throws
  // -------------------------------------------------------------------------
  it('throws "skill root not found" for an unknown rootId', async () => {
    await expect(
      replaceSkillResources({
        rootId: '00000000-0000-0000-0000-000000000000',
        newSha: 'sha',
        newSkillMdBody: '# body',
        newResources: [],
      }),
    ).rejects.toThrow('skill root not found');
  });

  // -------------------------------------------------------------------------
  // Test: no-source guard — authored skill (no source block) throws
  // -------------------------------------------------------------------------
  it('throws when called on an authored skill with no source block', async () => {
    // Seed an authored skill (no source field).
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Authored Skill',
      description: 'Hand-written, no upstream source.',
      skillMdBody: '# Authored',
      resources: [],
      // source intentionally omitted
    });

    await expect(
      replaceSkillResources({
        rootId,
        newSha: 'someshaaaaa',
        newSkillMdBody: '# Updated',
        newResources: [],
      }),
    ).rejects.toThrow('skill is not an install (no source block); cannot replace resources');
  });
});

// ---------------------------------------------------------------------------
// createResource
// ---------------------------------------------------------------------------

describe('createResource', () => {
  let f: Fixtures;

  beforeEach(async () => {
    f = await setupFixtures('create-resource');
  });

  afterEach(async () => {
    await teardownFixtures(f);
  });

  it('happy path — inserts child row with correct shape', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Authored Skill CR',
      description: 'For createResource tests.',
      skillMdBody: '# Root',
      resources: [],
    });

    const { resourceId } = await createResource({
      rootId,
      relativePath: 'templates/short.md',
      content: '# Short template\nContent here.',
    });

    expect(resourceId).toBeTruthy();

    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, resourceId));

    expect(row.type).toBe('skill-resource');
    expect(row.parentSkillId).toBe(rootId);
    expect(row.relativePath).toBe('templates/short.md');
    expect(row.title).toBe('short');
    expect(row.content).toBe('# Short template\nContent here.');
    expect(row.status).toBe('active');
    expect(row.version).toBe(1);
    expect(row.deletedAt).toBeNull();
  });

  it('rejects installed skills with "installed skill is read-only"', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Installed Skill CR',
      description: 'From GitHub.',
      skillMdBody: '# Root',
      resources: [],
      source: {
        github: { owner: 'acme', repo: 'skills', skill: 'test' },
        sha: 'abc',
        imported_at: new Date().toISOString(),
      },
    });

    await expect(
      createResource({ rootId, relativePath: 'guide.md', content: '# Guide' }),
    ).rejects.toThrow('installed skill is read-only');
  });

  it('rejects duplicate relativePath with "resource already exists"', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Dup Resource Skill',
      description: 'For dup test.',
      skillMdBody: '# Root',
      resources: [{ relative_path: 'guide.md', content: '# Existing' }],
    });

    await expect(
      createResource({ rootId, relativePath: 'guide.md', content: '# Dup' }),
    ).rejects.toThrow('resource already exists');
  });

  it('throws "skill root not found" for unknown rootId', async () => {
    await expect(
      createResource({
        rootId: '00000000-0000-0000-0000-000000000000',
        relativePath: 'guide.md',
        content: '# Guide',
      }),
    ).rejects.toThrow('skill root not found');
  });
});

// ---------------------------------------------------------------------------
// updateResource
// ---------------------------------------------------------------------------

describe('updateResource', () => {
  let f: Fixtures;

  beforeEach(async () => {
    f = await setupFixtures('update-resource');
  });

  afterEach(async () => {
    await teardownFixtures(f);
  });

  it('SKILL.md path — preserves frontmatter, replaces body, bumps version', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Update Root Test',
      description: 'For updateResource SKILL.md path.',
      skillMdBody: '# Original body',
      resources: [],
    });

    await updateResource({
      rootId,
      relativePath: 'SKILL.md',
      newContent: '# Updated body\n\nNew content here.',
    });

    const [root] = await db
      .select({ content: documents.content, version: documents.version })
      .from(documents)
      .where(eq(documents.id, rootId));

    // Version bumped
    expect(root.version).toBe(2);

    // Frontmatter preserved
    const fmBlock = root.content.slice(4, root.content.indexOf('\n---\n', 4));
    const fm = yaml.load(fmBlock) as Record<string, unknown>;
    expect(fm.name).toBe('Update Root Test');
    expect(fm.description).toBe('For updateResource SKILL.md path.');

    // New body present
    expect(root.content).toContain('# Updated body');
    expect(root.content).not.toContain('# Original body');
  });

  it('child path — updates resource content', async () => {
    const { rootId, resourceIds } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Update Child Test',
      description: 'For updateResource child path.',
      skillMdBody: '# Root',
      resources: [{ relative_path: 'guide.md', content: '# Old guide' }],
    });

    await updateResource({
      rootId,
      relativePath: 'guide.md',
      newContent: '# New guide content',
    });

    const [child] = await db
      .select({ content: documents.content })
      .from(documents)
      .where(eq(documents.id, resourceIds[0]));

    expect(child.content).toBe('# New guide content');
  });

  it('rejects installed skills with "installed skill is read-only"', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Installed Skill UR',
      description: 'Installed.',
      skillMdBody: '# Root',
      resources: [],
      source: {
        github: { owner: 'acme', repo: 'skills', skill: 'test' },
        sha: 'abc',
        imported_at: new Date().toISOString(),
      },
    });

    await expect(
      updateResource({ rootId, relativePath: 'SKILL.md', newContent: '# New' }),
    ).rejects.toThrow('installed skill is read-only');
  });

  it('throws "resource not found" for unknown child relativePath', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Missing Child Skill',
      description: 'No children.',
      skillMdBody: '# Root',
      resources: [],
    });

    await expect(
      updateResource({ rootId, relativePath: 'nonexistent.md', newContent: '# x' }),
    ).rejects.toThrow('resource not found');
  });
});

// ---------------------------------------------------------------------------
// deleteResource
// ---------------------------------------------------------------------------

describe('deleteResource', () => {
  let f: Fixtures;

  beforeEach(async () => {
    f = await setupFixtures('delete-resource');
  });

  afterEach(async () => {
    await teardownFixtures(f);
  });

  it('soft-deletes the matching child row', async () => {
    const { rootId, resourceIds } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Delete Child Test',
      description: 'For deleteResource.',
      skillMdBody: '# Root',
      resources: [{ relative_path: 'guide.md', content: '# Guide' }],
    });

    await deleteResource({ rootId, relativePath: 'guide.md' });

    const [child] = await db
      .select({ deletedAt: documents.deletedAt })
      .from(documents)
      .where(eq(documents.id, resourceIds[0]));

    expect(child.deletedAt).not.toBeNull();
  });

  it('rejects relativePath === SKILL.md', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Cannot Delete Root Test',
      description: 'For deleteResource SKILL.md guard.',
      skillMdBody: '# Root',
      resources: [],
    });

    await expect(
      deleteResource({ rootId, relativePath: 'SKILL.md' }),
    ).rejects.toThrow('cannot delete SKILL.md; delete the skill itself');
  });

  it('rejects installed skills with "installed skill is read-only"', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Installed Skill DR',
      description: 'Installed.',
      skillMdBody: '# Root',
      resources: [{ relative_path: 'guide.md', content: '# Guide' }],
      source: {
        github: { owner: 'acme', repo: 'skills', skill: 'test' },
        sha: 'abc',
        imported_at: new Date().toISOString(),
      },
    });

    await expect(
      deleteResource({ rootId, relativePath: 'guide.md' }),
    ).rejects.toThrow('installed skill is read-only');
  });

  it('throws "resource not found" for unknown relativePath', async () => {
    const { rootId } = await writeSkillTree({
      companyId: f.companyId,
      brainId: f.brainId,
      name: 'Missing Resource DR',
      description: 'No children.',
      skillMdBody: '# Root',
      resources: [],
    });

    await expect(
      deleteResource({ rootId, relativePath: 'nonexistent.md' }),
    ).rejects.toThrow('resource not found');
  });
});

// Transactional writer for skill trees.
//
// Two public functions:
//   writeSkillTree   — create a root 'skill' doc + N 'skill-resource' children
//   replaceSkillResources — atomically swap children, update root sha/version
//
// Both wrap their DB operations in a single drizzle transaction so a partial
// failure leaves nothing behind.

import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { eq, and, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { deriveResourceSlug, deriveResourcePath } from './resource-slug';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface WriteSkillTreeInput {
  companyId: string;
  brainId: string;
  name: string;
  description: string;
  skillMdBody: string;
  resources: Array<{ relative_path: string; content: string }>;
  source?: {
    github: { owner: string; repo: string; skill: string | null };
    sha: string;
    imported_at: string; // ISO
  };
}

export interface WriteSkillTreeResult {
  rootId: string;
  resourceIds: string[];
}

export interface ReplaceSkillResourcesInput {
  rootId: string;
  newSha: string;
  newSkillMdBody: string;
  newResources: Array<{ relative_path: string; content: string }>;
}

export interface ReplaceSkillResourcesResult {
  resourceIds: string[];
}

// ---------------------------------------------------------------------------
// Module-local helpers
// ---------------------------------------------------------------------------

/**
 * Slugify a skill name: lowercase, non-alphanumerics → '-', collapse repeats,
 * trim leading/trailing dashes. E.g. "My Cool Skill" → "my-cool-skill".
 * Written inline — no extra dep.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build the YAML frontmatter block for a root skill document.
 * Uses js-yaml so nested `source:` objects serialise cleanly (no manual
 * string building). Keys emitted in a deterministic order per spec.
 */
function serializeSkillFrontmatter(
  name: string,
  description: string,
  source?: WriteSkillTreeInput['source'],
): string {
  // Build the frontmatter object in spec-defined key order.
  // js-yaml preserves insertion order for plain objects in dump().
  const fm: Record<string, unknown> = {
    type: 'skill',
    name,
    description,
  };

  if (source) {
    fm.source = {
      github: source.github,
      sha: source.sha,
      imported_at: source.imported_at,
    };
  }

  // js-yaml dump produces "key: value\n" lines; strip trailing newline before
  // we wrap in '---\n...\n---'.
  const block = yaml.dump(fm, { lineWidth: -1 }).trimEnd();
  return `---\n${block}\n---`;
}

/**
 * Assemble full document content: YAML frontmatter + blank line + body.
 */
function buildRootContent(
  name: string,
  description: string,
  skillMdBody: string,
  source?: WriteSkillTreeInput['source'],
): string {
  return `${serializeSkillFrontmatter(name, description, source)}\n\n${skillMdBody}`;
}

/**
 * Derive the resource title from its relative_path: the filename without
 * extension. E.g. "references/interview.md" → "interview".
 */
function resourceTitle(relativePath: string): string {
  const base = relativePath.split('/').at(-1) ?? relativePath;
  const dotIdx = base.lastIndexOf('.');
  return dotIdx > 0 ? base.slice(0, dotIdx) : base;
}

// ---------------------------------------------------------------------------
// writeSkillTree
// ---------------------------------------------------------------------------

/**
 * Insert one root 'skill' document plus N 'skill-resource' children in a
 * single transaction. Returns the root id and the list of resource ids.
 *
 * UUIDs for resource rows are generated client-side so slug/path can be
 * derived from them before the insert (standard drizzle practice — the
 * defaultRandom() column accepts an explicit value when supplied).
 */
export async function writeSkillTree(
  input: WriteSkillTreeInput,
): Promise<WriteSkillTreeResult> {
  const { companyId, brainId, name, description, skillMdBody, resources, source } = input;

  const rootSlug = slugify(name);
  if (!rootSlug) {
    throw new Error(`skill name "${name}" produces an empty slug`);
  }
  const rootPath = `skills/${rootSlug}`;
  const rootContent = buildRootContent(name, description, skillMdBody, source);

  return db.transaction(async (tx) => {
    // 1. Insert root skill document.
    const [rootRow] = await tx
      .insert(documents)
      .values({
        companyId,
        brainId,
        folderId: null,     // skills live outside folder taxonomy (mirrors seed-builtins pattern)
        ownerId: null,      // system-level; Quick-form/fork add ownership separately
        parentSkillId: null,
        relativePath: null,
        type: 'skill',
        title: name,
        slug: rootSlug,
        path: rootPath,
        content: rootContent,
        summary: null,
        status: 'active',
        confidenceLevel: 'medium',
        isCore: false,
        version: 1,
      })
      .returning({ id: documents.id });

    const rootId = rootRow.id;

    // 2. Insert resource children, each with a client-generated UUID so the
    //    slug/path can be computed from the id before the insert.
    const resourceIds: string[] = [];

    for (const res of resources) {
      const resourceId = randomUUID();
      const resSlug = deriveResourceSlug(resourceId);
      const resPath = deriveResourcePath(rootSlug, res.relative_path);

      await tx.insert(documents).values({
        id: resourceId,
        companyId,
        brainId,
        folderId: null,
        ownerId: null,
        parentSkillId: rootId,
        relativePath: res.relative_path,
        type: 'skill-resource',
        title: resourceTitle(res.relative_path),
        slug: resSlug,
        path: resPath,
        content: res.content,  // raw — no frontmatter wrapping for resources
        summary: null,
        status: 'active',
        confidenceLevel: 'medium',
        isCore: false,
        version: 1,
      });

      resourceIds.push(resourceId);
    }

    return { rootId, resourceIds };
  });
}

// ---------------------------------------------------------------------------
// replaceSkillResources
// ---------------------------------------------------------------------------

/**
 * Atomically swap out the resource children of an existing skill root.
 * Inside one transaction:
 *   1. Hard-delete every current child (parent_skill_id = rootId).
 *   2. Insert the new resources (fresh UUIDs, fresh slugs/paths).
 *   3. UPDATE the root: new content (preserved github, new sha/imported_at),
 *      version + 1, updatedAt = now().
 *
 * Throws 'skill root not found' if rootId is missing or not type='skill'.
 */
export async function replaceSkillResources(
  input: ReplaceSkillResourcesInput,
): Promise<ReplaceSkillResourcesResult> {
  const { rootId, newSha, newSkillMdBody, newResources } = input;

  return db.transaction(async (tx) => {
    // Look up the root INSIDE the transaction with a row-level lock so a
    // concurrent replaceSkillResources on the same root serialises rather
    // than racing for the version bump (fixes the TOCTOU window).
    const [existingRoot] = await tx
      .select({
        id: documents.id,
        type: documents.type,
        slug: documents.slug,
        content: documents.content,
        version: documents.version,
        companyId: documents.companyId,
        brainId: documents.brainId,
      })
      .from(documents)
      .where(and(eq(documents.id, rootId), isNull(documents.deletedAt)))
      .for('update')
      .limit(1);

    if (!existingRoot || existingRoot.type !== 'skill') {
      throw new Error('skill root not found');
    }

    // Parse the existing frontmatter to recover the name, description, and
    // source.github sub-block. We use js-yaml for this because the frontmatter
    // may contain nested `source:` objects that parseFrontmatterRaw (which only
    // handles flat key:value lines) cannot reconstruct.
    const fmEndIdx = existingRoot.content.indexOf('\n---\n', 4);
    const existingFmBlock =
      fmEndIdx !== -1
        ? existingRoot.content.slice(4, fmEndIdx)
        : '';
    const existingFm = (
      yaml.load(existingFmBlock) as Record<string, unknown> | null
    ) ?? {};

    const existingSource = existingFm.source as
      | { github: { owner: string; repo: string; skill: string | null }; sha: string; imported_at: string }
      | undefined;

    // Guard: replaceSkillResources is only valid for upstream-tracked skills.
    // Authored skills have no source block and no github sub-block.
    if (!existingSource?.github) {
      throw new Error('skill is not an install (no source block); cannot replace resources');
    }

    // Build the updated source block: preserve github, overwrite sha + imported_at.
    const updatedSource: WriteSkillTreeInput['source'] = {
      github: existingSource.github,
      sha: newSha,
      imported_at: new Date().toISOString(),
    };

    const rootSlug = existingRoot.slug;
    const name = typeof existingFm.name === 'string' ? existingFm.name : '';
    const description = typeof existingFm.description === 'string' ? existingFm.description : '';
    const newContent = buildRootContent(name, description, newSkillMdBody, updatedSource);

    const { companyId, brainId, version: currentVersion } = existingRoot;

    // 1. Hard-delete all existing children.
    await tx
      .delete(documents)
      .where(eq(documents.parentSkillId, rootId));

    // 2. Insert fresh resources with new UUIDs.
    const resourceIds: string[] = [];

    for (const res of newResources) {
      const resourceId = randomUUID();
      const resSlug = deriveResourceSlug(resourceId);
      const resPath = deriveResourcePath(rootSlug, res.relative_path);

      await tx.insert(documents).values({
        id: resourceId,
        companyId,
        brainId,
        folderId: null,
        ownerId: null,
        parentSkillId: rootId,
        relativePath: res.relative_path,
        type: 'skill-resource',
        title: resourceTitle(res.relative_path),
        slug: resSlug,
        path: resPath,
        content: res.content,
        summary: null,
        status: 'active',
        confidenceLevel: 'medium',
        isCore: false,
        version: 1,
      });

      resourceIds.push(resourceId);
    }

    // 3. Update root: new content, version+1, updatedAt=now().
    await tx
      .update(documents)
      .set({
        content: newContent,
        version: currentVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, rootId));

    return { resourceIds };
  });
}

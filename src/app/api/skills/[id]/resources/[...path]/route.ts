// PATCH /api/skills/[id]/resources/[...path]
// DELETE /api/skills/[id]/resources/[...path]
//
// PATCH updates a file's content:
//   - path segments joined with '/' → relativePath
//   - relativePath === 'SKILL.md' → update root body (frontmatter preserved)
//   - any other path → update the child resource's content
//
// DELETE soft-deletes a child resource.
//   - relativePath === 'SKILL.md' is rejected (400) — delete the whole skill
//     via DELETE /api/skills/[id] instead.
//
// Installed skills (source.github present) are rejected with 403 for both.
//
// Error mapping:
//   invalid JSON / bad body             → 400 invalid_input
//   relativePath === SKILL.md on DELETE → 400 invalid_input
//   skill not found                     → 404 not_found
//   installed skill                     → 403 read_only
//   resource not found                  → 404 not_found
//   internal error                      → 500 internal_error

import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { updateResource, deleteResource } from '@/lib/skills/write-skill-tree';

type RouteCtx = { params: Promise<{ id: string; path: string[] }> };

const patchSchema = z
  .object({
    content: z.string(),
  })
  .strict();

// Whitelist regex for individual path segments: alphanumerics, dots, underscores, hyphens.
// Rejects '..' traversals, whitespace, and any other unexpected characters.
const SAFE_SEGMENT_RE = /^[\w.\-]+$/;

/**
 * Validate every segment of a decoded path array.
 * Returns true if all segments are safe; false otherwise.
 */
function validatePathSegments(segments: string[]): boolean {
  return segments.every((seg) => SAFE_SEGMENT_RE.test(seg));
}

// ─── Shared skill lookup ──────────────────────────────────────────────────────

async function lookupSkill(id: string, brainId: string) {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, id),
        eq(documents.brainId, brainId),
        isNull(documents.deletedAt),
        eq(documents.type, 'skill'),
      ),
    )
    .limit(1);
  return row ?? null;
}

function mapHelperError(msg: string, relativePath: string): Response | null {
  if (msg === 'installed skill is read-only') {
    return error('read_only', 'Installed skills are read-only.', 403);
  }
  if (msg === 'skill root not found') {
    return error('not_found', 'Skill not found.', 404);
  }
  if (msg === 'resource not found') {
    return error('not_found', `Resource "${relativePath}" not found.`, 404);
  }
  return null;
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export const PATCH = (req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id, path: pathSegments } = await params;

    if (!validatePathSegments(pathSegments)) {
      return error('invalid_input', 'invalid path segment', 400);
    }

    const relativePath = pathSegments.join('/');

    const companyIdOrResponse = requireCompany(ctx);
    if (companyIdOrResponse instanceof Response) return companyIdOrResponse;
    const companyId = companyIdOrResponse;

    // Parse body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_input', 'Request body must be valid JSON.', 400);
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_input', parsed.error.message, 400);
    }

    const { content } = parsed.data;

    // Verify skill belongs to this company.
    const brain = await getBrainForCompany(companyId);
    const skill = await lookupSkill(id, brain.id);
    if (!skill) return error('not_found', 'Skill not found.', 404);

    try {
      await updateResource({ rootId: id, relativePath, newContent: content });
      return success({ updated: true, relative_path: relativePath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const mapped = mapHelperError(msg, relativePath);
      if (mapped) return mapped;
      throw e;
    }
  });

// ─── DELETE ───────────────────────────────────────────────────────────────────

export const DELETE = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id, path: pathSegments } = await params;

    if (!validatePathSegments(pathSegments)) {
      return error('invalid_input', 'invalid path segment', 400);
    }

    const relativePath = pathSegments.join('/');

    const companyIdOrResponse = requireCompany(ctx);
    if (companyIdOrResponse instanceof Response) return companyIdOrResponse;
    const companyId = companyIdOrResponse;

    if (relativePath === 'SKILL.md') {
      return error(
        'invalid_input',
        'Cannot delete SKILL.md. To remove the skill entirely, use DELETE /api/skills/[id].',
        400,
      );
    }

    // Verify skill belongs to this company.
    const brain = await getBrainForCompany(companyId);
    const skill = await lookupSkill(id, brain.id);
    if (!skill) return error('not_found', 'Skill not found.', 404);

    try {
      await deleteResource({ rootId: id, relativePath });
      return success({ deleted: true, relative_path: relativePath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const mapped = mapHelperError(msg, relativePath);
      if (mapped) return mapped;
      throw e;
    }
  });

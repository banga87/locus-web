// POST /api/skills/[id]/resources
//
// Inserts a new skill-resource child row under an authored/forked skill.
// Installed skills (source.github present) are rejected with 403.
//
// Error mapping:
//   invalid JSON / bad body             → 400 invalid_input
//   empty/invalid relative_path         → 400 invalid_input
//   skill not found                     → 404 not_found
//   installed skill                     → 403 read_only
//   resource already exists             → 409 resource_exists
//   internal error                      → 500 internal_error

import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { created, error } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { createResource } from '@/lib/skills/write-skill-tree';

type RouteCtx = { params: Promise<{ id: string }> };

// Whitelist regex for individual path segments: alphanumerics, dots, underscores, hyphens.
// Must match the same rule enforced on the PATCH/DELETE [...path] route.
const SAFE_SEGMENT_RE = /^[\w.\-]+$/;

const postSchema = z
  .object({
    relative_path: z
      .string()
      .min(1, 'relative_path is required')
      .max(256, 'relative_path too long')
      .refine((p) => !p.startsWith('/'), 'relative_path must not start with /')
      .refine(
        (p) => p.split('/').every((seg) => SAFE_SEGMENT_RE.test(seg)),
        'invalid path segment',
      ),
    content: z.string(),
  })
  .strict();

export const POST = (req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;
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

    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_input', parsed.error.message, 400);
    }

    const { relative_path, content } = parsed.data;

    // Verify the skill exists and belongs to this company/brain.
    const brain = await getBrainForCompany(companyId);

    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
          eq(documents.type, 'skill'),
        ),
      )
      .limit(1);

    if (!existing) return error('not_found', 'Skill not found.', 404);

    // Delegate to helper (handles installed guard + duplicate check).
    try {
      const { resourceId } = await createResource({
        rootId: id,
        relativePath: relative_path,
        content,
      });

      return created({ resource_id: resourceId, relative_path });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg === 'installed skill is read-only') {
        return error('read_only', 'Installed skills are read-only.', 403);
      }
      if (msg === 'resource already exists') {
        return error('resource_exists', `A resource at "${relative_path}" already exists.`, 409);
      }
      if (msg === 'skill root not found') {
        return error('not_found', 'Skill not found.', 404);
      }

      throw e;
    }
  });

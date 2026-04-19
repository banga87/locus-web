// POST /api/skills/[id]/fork
//
// Clones a skill tree into a fork in the same company/brain.
// The fork strips `source.github` and adds `source.forked_from` so
// parseOrigin identifies the clone as 'forked'. Name is suffixed with
// " (fork)"; slug is re-derived.
//
// Error mapping:
//   missing/deleted skill        → 404 not_found
//   slug already taken           → 409 slug_taken
//   not authenticated            → 401 unauthenticated
//   no companyId on profile      → 403 no_company

import { withAuth, requireCompany } from '@/lib/api/handler';
import { created, error } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { forkSkill } from '@/lib/skills/write-skill-tree';

type RouteCtx = { params: Promise<{ id: string }> };

export const POST = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;
    const companyIdOrResponse = requireCompany(ctx);
    if (companyIdOrResponse instanceof Response) return companyIdOrResponse;
    const companyId = companyIdOrResponse;

    const brain = await getBrainForCompany(companyId);

    try {
      const { newRootId } = await forkSkill({
        rootId: id,
        companyId,
        brainId: brain.id,
      });

      return created({ skill_id: newRootId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg === 'skill root not found') {
        return error('not_found', 'Skill not found.', 404);
      }
      if (msg === 'slug_taken') {
        return error('slug_taken', 'A skill with that name already exists in this workspace.', 409);
      }

      console.error('[api/skills/fork] unexpected error:', e);
      return error('internal_error', 'An unexpected error occurred.', 500);
    }
  });

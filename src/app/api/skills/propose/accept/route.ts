// POST /api/skills/propose/accept
//
// Server-side acceptance handler for `propose_skill_create` proposals.
//
// The client (SkillProposalCard) sends the raw proposal payload — minus the
// `kind` discriminator which is tool-output-only — after the user clicks
// Approve. This route:
//   1. Re-validates the input with the same zod schema the tool uses (server
//      must not trust the client).
//   2. Resolves the company's brain.
//   3. Calls `writeSkillTree` to materialise the skill tree in the DB.
//   4. Returns 201 { skill_id } on success so the card can link to the new skill.
//
// Error mapping mirrors POST /api/skills (see route.ts lines 133–190):
//   invalid JSON        → 400 invalid_input
//   zod failure         → 400 invalid_input
//   empty slug          → 400 invalid_input
//   23505 / slug_taken  → 409 slug_taken
//   other               → 500 internal_error
//
// Auth: `withAuth` + `requireCompany` — same as every brain/skill route.

import { z } from 'zod';

import { withAuth, requireCompany } from '@/lib/api/handler';
import { created, error } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { writeSkillTree } from '@/lib/skills/write-skill-tree';

// ---------------------------------------------------------------------------
// Schema — mirrors the tool's input schema (no `kind` field).
// ---------------------------------------------------------------------------

const acceptSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(1000),
    body: z.string().min(1),
    resources: z.array(
      z.object({
        relative_path: z.string().min(1).max(256),
        content: z.string(),
      }),
    ).default([]),
    rationale: z.string().min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST = (req: Request) =>
  withAuth(async (ctx) => {
    const companyIdOrResponse = requireCompany(ctx);
    if (companyIdOrResponse instanceof Response) return companyIdOrResponse;
    const companyId = companyIdOrResponse;

    // 1. Parse + validate body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_input', 'Request body must be valid JSON.', 400);
    }

    const parsed = acceptSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_input', parsed.error.message, 400);
    }

    const { name, description, body: skillMdBody, resources } = parsed.data;

    // 2. Resolve brain.
    const brain = await getBrainForCompany(companyId);

    // 3. Write skill tree (root + resource children).
    let rootId: string;
    try {
      const result = await writeSkillTree({
        companyId,
        brainId: brain.id,
        name,
        description,
        skillMdBody,
        resources,
        // source: undefined — agent-proposed skill is authored, not installed
      });
      rootId = result.rootId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg.includes('produces an empty slug')) {
        return error('invalid_input', msg, 400);
      }

      // Postgres 23505 unique-constraint violation on (brain_id, slug) partial index.
      if (msg.includes('slug_taken') || msg.includes('23505')) {
        return error(
          'slug_taken',
          `A skill named '${name}' already exists in this workspace.`,
          409,
        );
      }

      return error('internal_error', 'Failed to create skill.', 500);
    }

    return created({ skill_id: rootId });
  });

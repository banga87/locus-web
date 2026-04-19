// POST /api/skills/import
//
// Takes { url, confirmed_sha, skillName? }, fetches the SkillPreview pinned
// to confirmed_sha (the SHA the user reviewed), writes the skill tree to the
// DB via writeSkillTree, and returns { skill_id }.
//
// Using confirmed_sha guarantees the user installs exactly what they reviewed —
// not whatever is currently at HEAD.
//
// Error mapping:
//   Zod parse fail                                   → 400  invalid_input
//   parseSkillUrl throws "unrecognised URL: …"       → 400  invalid_url
//   fetchSkillPreview throws "GitHub returned 404: …"→ 409  sha_not_found
//   fetchSkillPreview throws "not a valid skill …"   → 400  not_a_skill
//   fetchSkillPreview throws "the skill's description is empty…" → 422 empty_description
//   fetchSkillPreview throws "GitHub API rate limit …"→ 429  rate_limited
//   any other upstream error                         → 502  upstream_error
//   writeSkillTree throws "… produces an empty slug" → 400  invalid_input
//   writeSkillTree throws (slug uniqueness/duplicate) → 409 slug_taken

import { z } from 'zod';

import { withAuth, requireCompany } from '@/lib/api/handler';
import { created, error } from '@/lib/api/response';
import { fetchSkillPreview, parseSkillUrl } from '@/lib/skills/github-import';
import { writeSkillTree } from '@/lib/skills/write-skill-tree';
import { getBrainForCompany } from '@/lib/brain/queries';

const schema = z
  .object({
    url: z.string().url(),
    confirmed_sha: z.string().min(1),
    skillName: z.string().trim().min(1).optional(),
  })
  .strict();

export const POST = (req: Request) =>
  withAuth(async (ctx) => {
    // 1. Company required — skills belong to a workspace.
    const companyIdOrResponse = requireCompany(ctx);
    if (companyIdOrResponse instanceof Response) return companyIdOrResponse;
    const companyId = companyIdOrResponse;

    // 2. Parse + validate body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_input', 'Request body must be valid JSON.', 400);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_input', parsed.error.message, 400);
    }

    const { url, confirmed_sha, skillName } = parsed.data;

    // 3. Parse the skill URL.
    let parsedUrl;
    try {
      parsedUrl = parseSkillUrl(url, skillName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('unrecognised URL')) {
        return error('invalid_url', msg, 400);
      }
      return error('invalid_url', `Could not parse URL: ${msg}`, 400);
    }

    // 4. Fetch the preview pinned to confirmed_sha.
    let preview;
    try {
      preview = await fetchSkillPreview(parsedUrl, { pinSha: confirmed_sha });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg.startsWith('GitHub returned 404')) {
        return error(
          'sha_not_found',
          'The pinned commit no longer exists upstream. Please re-preview the skill.',
          409,
        );
      }

      if (msg.startsWith('GitHub API rate limit exceeded')) {
        return error('rate_limited', msg, 429);
      }

      if (msg.startsWith("the skill's description is empty")) {
        return error('empty_description', msg, 422);
      }

      if (msg.startsWith('not a valid skill')) {
        return error('not_a_skill', msg, 400);
      }

      return error('upstream_error', `Upstream error: ${msg}`, 502);
    }

    // 5. Resolve brain for this company.
    const brain = await getBrainForCompany(companyId);

    // 6. Write the skill tree (root doc + resource children).
    let rootId: string;
    try {
      const result = await writeSkillTree({
        companyId,
        brainId: brain.id,
        name: preview.name,
        description: preview.description,
        skillMdBody: preview.skillMdBody,
        resources: preview.resources,
        source: {
          github: {
            owner: parsedUrl.owner,
            repo: parsedUrl.repo,
            skill: parsedUrl.skillName,
          },
          sha: confirmed_sha,
          imported_at: new Date().toISOString(),
        },
      });
      rootId = result.rootId;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg.includes('produces an empty slug')) {
        return error('invalid_input', msg, 400);
      }

      // Duplicate slug — partial unique index on (company_id, slug) for
      // non-deleted skill docs throws a DB unique constraint violation.
      return error(
        'slug_taken',
        `A skill named '${preview.name}' already exists in this workspace.`,
        409,
      );
    }

    // 7. Return the root skill id.
    return created({ skill_id: rootId });
  });

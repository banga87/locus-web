// POST /api/skills/import/preview
//
// Fetches a SkillPreview for a given URL so the client can show the user
// what they're about to install. Read-only — no DB writes, no companyId
// required. Auth is still enforced (any signed-in user).
//
// Error mapping:
//   parseSkillUrl throws "unrecognised URL: …"       → 400 invalid_url
//   fetchSkillPreview throws "not a valid skill …"   → 400 not_a_skill
//   fetchSkillPreview throws "GitHub returned 404: …"→ 404 not_found
//   fetchSkillPreview throws "GitHub API rate limit …"→ 429 rate_limited
//   fetchSkillPreview throws "the skill's description is empty…" → 422 empty_description
//   anything else                                    → 502 upstream_error

import { z } from 'zod';

import { withAuth } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { fetchSkillPreview, parseSkillUrl } from '@/lib/skills/github-import';

const schema = z
  .object({
    url: z.string().url().min(1),
    skillName: z.string().trim().min(1).optional(),
  })
  .strict();

export const POST = (req: Request) =>
  withAuth(async () => {
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

    const { url, skillName } = parsed.data;

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

    try {
      const preview = await fetchSkillPreview(parsedUrl, skillName ? {} : {});
      return success(preview);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg.startsWith('GitHub returned 404')) {
        return error(
          'not_found',
          "Couldn't find that skill on GitHub. Check the URL or that the repo is public.",
          404,
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

      // Catch-all for upstream errors (e.g. GitHub 500, network failures)
      return error('upstream_error', `Upstream error: ${msg}`, 502);
    }
  });

// POST /api/skills/[id]/update/preview
//
// Checks whether there is a new upstream SHA for an installed skill. Returns
// { up_to_date: true } when the stored SHA matches the latest, or
// { up_to_date: false, current_sha, latest_sha, preview } when there is an
// update available.
//
// Error mapping:
//   skill missing or already deleted          → 404 not_found
//   skill has no source.github block          → 400 not_an_install
//   fetchSkillPreview throws "GitHub returned 404: …" → 404 not_found
//   fetchSkillPreview throws "GitHub API rate limit …" → 429 rate_limited
//   fetchSkillPreview throws "not a valid skill …"    → 400 not_a_skill
//   any other upstream error                  → 502 upstream_error

import yaml from 'js-yaml';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { fetchSkillPreview } from '@/lib/skills/github-import';
import type { ParsedSkillUrl } from '@/lib/skills/github-import';

type RouteCtx = { params: Promise<{ id: string }> };

export const POST = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;
    const companyIdOrResponse = requireCompany(ctx);
    if (companyIdOrResponse instanceof Response) return companyIdOrResponse;
    const companyId = companyIdOrResponse;

    // 1. Look up the skill root scoped to this company/brain.
    const brain = await getBrainForCompany(companyId);

    const [row] = await db
      .select({ id: documents.id, content: documents.content })
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

    if (!row) return error('not_found', 'Skill not found.', 404);

    // 2. Parse frontmatter to recover source.github.
    const fmMatch = row.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fmBlock = fmMatch ? fmMatch[1] : '';
    let fm: Record<string, unknown> = {};
    try {
      fm = (yaml.load(fmBlock) as Record<string, unknown> | null) ?? {};
    } catch {
      // Malformed YAML — treat as not-an-install.
    }

    const source = fm.source as
      | {
          github?: { owner?: string; repo?: string; skill?: string | null };
          sha?: string;
        }
      | undefined;

    if (!source?.github?.owner || !source?.github?.repo) {
      return error('not_an_install', 'Skill is not an install (no source.github block).', 400);
    }

    const currentSha = source.sha ?? '';

    // 3. Reconstruct ParsedSkillUrl and fetch the latest preview (no pinSha).
    const parsed: ParsedSkillUrl = {
      owner: source.github.owner,
      repo: source.github.repo,
      skillName: source.github.skill ?? null,
    };

    let preview;
    try {
      preview = await fetchSkillPreview(parsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg.startsWith('GitHub returned 404')) {
        return error(
          'not_found',
          "Couldn't find that skill on GitHub. The repository or skill may have been removed.",
          404,
        );
      }

      if (msg.startsWith('GitHub API rate limit exceeded')) {
        return error('rate_limited', msg, 429);
      }

      if (msg.startsWith('not a valid skill')) {
        return error('not_a_skill', msg, 400);
      }

      if (msg.startsWith("the skill's description is empty")) {
        return error('empty_description', msg, 422);
      }

      return error('upstream_error', `Upstream error: ${msg}`, 502);
    }

    // 4. Compare SHAs and return the appropriate payload.
    if (preview.sha === currentSha) {
      return success({ up_to_date: true, current_sha: currentSha });
    }

    return success({
      up_to_date: false,
      current_sha: currentSha,
      latest_sha: preview.sha,
      preview,
    });
  });

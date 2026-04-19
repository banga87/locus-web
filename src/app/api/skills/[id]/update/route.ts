// POST /api/skills/[id]/update
//
// Atomically replaces the skill's resource children and bumps the root SHA
// to `target_sha`. The caller must have previously called /update/preview
// and confirmed the target_sha they want to apply.
//
// Error mapping:
//   missing/deleted skill                     → 404 not_found
//   skill has no source.github block          → 400 not_an_install
//   fetchSkillPreview throws "GitHub returned 404: …" → 409 sha_not_found
//   fetchSkillPreview throws "GitHub API rate limit …" → 429 rate_limited
//   fetchSkillPreview throws "not a valid skill …"  → 400 not_a_skill
//   fetchSkillPreview throws "…description is empty" → 422 empty_description
//   any other upstream error                  → 502 upstream_error
//   replaceSkillResources throws "skill root not found" → 404 not_found
//   replaceSkillResources throws "skill is not an install…" → 400 not_an_install

import { z } from 'zod';
import yaml from 'js-yaml';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { fetchSkillPreview } from '@/lib/skills/github-import';
import type { ParsedSkillUrl } from '@/lib/skills/github-import';
import { replaceSkillResources } from '@/lib/skills/write-skill-tree';

type RouteCtx = { params: Promise<{ id: string }> };

const schema = z
  .object({
    target_sha: z.string().min(1),
  })
  .strict();

export const POST = (req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;
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

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_input', parsed.error.message, 400);
    }

    const { target_sha } = parsed.data;

    // 2. Look up the skill root scoped to this company/brain.
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

    // 3. Parse frontmatter to recover source.github.
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

    // 4. Fetch the preview pinned at target_sha.
    const parsedUrl: ParsedSkillUrl = {
      owner: source.github.owner,
      repo: source.github.repo,
      skillName: source.github.skill ?? null,
    };

    let preview;
    try {
      preview = await fetchSkillPreview(parsedUrl, { pinSha: target_sha });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      if (msg.startsWith('GitHub returned 404')) {
        return error(
          'sha_not_found',
          'The pinned commit no longer exists upstream. Re-preview the update.',
          409,
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

    // 5. Atomically replace resource children and bump root SHA.
    try {
      await replaceSkillResources({
        rootId: id,
        newSha: target_sha,
        newSkillMdBody: preview.skillMdBody,
        newResources: preview.resources,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'skill root not found') {
        return error('not_found', 'Skill not found.', 404);
      }
      if (msg.startsWith('skill is not an install')) {
        return error('not_an_install', msg, 400);
      }
      throw e;
    }

    return success({ skill_id: id, new_sha: target_sha });
  });

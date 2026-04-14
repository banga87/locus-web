// GET /api/agents/[id]    — fetch a single agent-definition.
// PATCH /api/agents/[id]  — update an agent-definition via partial
//                           wizard input. Rebuilds the markdown from
//                           the merged frontmatter and writes a new
//                           document-version snapshot.
// DELETE /api/agents/[id] — soft-delete. Blocks with 409 if any
//                           active session still references this agent
//                           via `sessions.agent_definition_id`.
//
// Auth: Viewer+ on GET, Editor+ on PATCH, Owner only on DELETE
// (mirrors `/api/brain/documents/[id]`).

import { and, eq, isNull } from 'drizzle-orm';
import yaml from 'js-yaml';
import { z } from 'zod';

import { db } from '@/db';
import { documents, documentVersions, sessions } from '@/db/schema';
import { requireRole } from '@/lib/api/auth';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';

import { buildAgentDefinitionDoc } from '@/lib/agents/definitions';
import {
  ALLOWED_MODELS,
  type AgentWizardInput,
} from '@/lib/agents/wizard-schema';

type RouteCtx = { params: Promise<{ id: string }> };

// Partial version of the wizard input for PATCH. Each field is
// individually optional; the body must be non-empty. We don't reuse
// `agentWizardInputSchema.partial()` because we want the same
// per-field bounds without the non-empty-object refinement.
const patchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(128).optional(),
    model: z.enum(ALLOWED_MODELS).optional(),
    toolAllowlist: z.array(z.string()).nullable().optional(),
    baselineDocIds: z.array(z.string().uuid()).optional(),
    skillIds: z.array(z.string().uuid()).optional(),
    systemPromptSnippet: z.string().max(4000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field required.');

const AGENT_PATH_PREFIX = 'agents/';

// Extract typed wizard fields out of the stored frontmatter block.
// Agent-definition frontmatter is always produced by
// `buildAgentDefinitionDoc`, so the shapes match the wizard schema
// field-for-field. We use `js-yaml` directly here (rather than the raw
// line-based parser in `@/lib/brain/save`) because agent-definition
// frontmatter contains arrays (`baseline_docs`, `skills`,
// `tool_allowlist`) that the raw parser doesn't handle.
function readAgentFrontmatter(content: string): Partial<AgentWizardInput> & {
  type?: string;
} {
  if (!content.startsWith('---\n')) return {};
  // `buildAgentDefinitionDoc` always emits `\n---\n` (trailing newline
  // after the close fence), so we don't need an EOF fallback.
  const closeIdx = content.indexOf('\n---\n', 4);
  if (closeIdx === -1) return {};
  const block = content.slice(4, closeIdx);

  const parsed = yaml.load(block) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return {};

  const toStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === 'string')
      ? (v as string[])
      : undefined;

  return {
    type: typeof parsed.type === 'string' ? parsed.type : undefined,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    slug: typeof parsed.slug === 'string' ? parsed.slug : undefined,
    model:
      typeof parsed.model === 'string' &&
      (ALLOWED_MODELS as readonly string[]).includes(parsed.model)
        ? (parsed.model as AgentWizardInput['model'])
        : undefined,
    toolAllowlist:
      parsed.tool_allowlist === null
        ? undefined
        : toStringArray(parsed.tool_allowlist),
    baselineDocIds: toStringArray(parsed.baseline_docs),
    skillIds: toStringArray(parsed.skills),
    systemPromptSnippet:
      typeof parsed.system_prompt_snippet === 'string'
        ? parsed.system_prompt_snippet
        : undefined,
  };
}

export const GET = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const [row] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!row) return error('not_found', 'Agent not found.', 404);
    if (row.type !== 'agent-definition') {
      // Same 404 as missing — don't leak that a non-agent doc exists
      // under this id.
      return error('not_found', 'Agent not found.', 404);
    }

    const frontmatter = readAgentFrontmatter(row.content);

    return success({
      id: row.id,
      title: row.title,
      slug: row.slug,
      path: row.path,
      status: row.status,
      version: row.version,
      type: row.type,
      content: row.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // Parsed wizard fields — handy for prefilling the edit form.
      model: frontmatter.model,
      toolAllowlist: frontmatter.toolAllowlist ?? null,
      baselineDocIds: frontmatter.baselineDocIds ?? [],
      skillIds: frontmatter.skillIds ?? [],
      systemPromptSnippet: frontmatter.systemPromptSnippet ?? '',
    });
  });

export const PATCH = (req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    requireRole(ctx, 'editor');
    const { id } = await params;
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_json', 'Request body must be JSON.', 400);
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return error(
        'invalid_body',
        'Invalid patch.',
        400,
        parsed.error.issues,
      );
    }
    const patch = parsed.data;

    const brain = await getBrainForCompany(companyId);

    const [existing] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!existing || existing.type !== 'agent-definition') {
      return error('not_found', 'Agent not found.', 404);
    }

    // Merge: read stored frontmatter → overlay patch fields → reissue
    // `buildAgentDefinitionDoc` to regenerate the markdown content.
    // Any field missing from both the patch and the stored frontmatter
    // is defaulted to the wizard minimum; this path should be
    // unreachable in practice because POST validates a full input.
    const stored = readAgentFrontmatter(existing.content);

    // Slug conflict check — only when the slug actually changes. There
    // is a race window between this select and the update below where a
    // concurrent insert could land on the same slug; we accept that for
    // MVP (same trade-off as the POST path, see route.ts:102-103).
    if (patch.slug !== undefined && patch.slug !== existing.slug) {
      const [collision] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.brainId, brain.id),
            eq(documents.slug, patch.slug),
            eq(documents.type, 'agent-definition'),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);
      if (collision && collision.id !== id) {
        return error(
          'slug_conflict',
          'An agent with that slug already exists.',
          409,
        );
      }
    }

    // If both the patch and stored frontmatter lack `model`, we'd have
    // silently defaulted — masking data corruption in the stored doc.
    // Fail loudly instead so the missing field is visible.
    const storedModel = stored.model;
    const effectiveModel = patch.model ?? storedModel;
    if (
      typeof effectiveModel !== 'string' ||
      !(ALLOWED_MODELS as readonly string[]).includes(effectiveModel)
    ) {
      console.warn(
        `[agents] PATCH on ${id}: stored agent has invalid/missing model; cannot safely rewrite frontmatter`,
      );
      return error(
        'corrupt_agent',
        'Stored agent-definition is missing or has an invalid model field.',
        500,
      );
    }

    const merged: AgentWizardInput = {
      title: patch.title ?? stored.title ?? existing.title,
      slug: patch.slug ?? stored.slug ?? existing.slug,
      model: effectiveModel,
      toolAllowlist:
        patch.toolAllowlist === null
          ? undefined
          : patch.toolAllowlist ?? stored.toolAllowlist,
      baselineDocIds:
        patch.baselineDocIds ?? stored.baselineDocIds ?? [],
      skillIds: patch.skillIds ?? stored.skillIds ?? [],
      systemPromptSnippet:
        patch.systemPromptSnippet ?? stored.systemPromptSnippet ?? '',
    };

    const built = buildAgentDefinitionDoc(merged);
    const nextVersion = existing.version + 1;
    const newSlug = merged.slug;
    const newPath =
      newSlug !== existing.slug
        ? `${AGENT_PATH_PREFIX}${newSlug}`
        : existing.path;
    const changedKeys = Object.keys(patch);
    const summary = `updated: ${changedKeys.join(', ')}`;

    const [updated] = await db
      .update(documents)
      .set({
        title: merged.title,
        slug: newSlug,
        path: newPath,
        content: built.content,
        type: 'agent-definition',
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .returning();

    await db.insert(documentVersions).values({
      companyId,
      documentId: id,
      versionNumber: nextVersion,
      content: built.content,
      changeSummary: summary,
      changedBy: ctx.userId,
      changedByType: 'human',
      metadataSnapshot: {
        title: updated.title,
        status: updated.status,
        confidenceLevel: updated.confidenceLevel,
      },
    });

    await tryRegenerateManifest(brain.id);
    // No skill-manifest rebuild — agent-definitions aren't skills.

    return success(updated);
  });

export const DELETE = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    requireRole(ctx, 'owner');
    const { id } = await params;
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const [existing] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (!existing || existing.type !== 'agent-definition') {
      return error('not_found', 'Agent not found.', 404);
    }

    // Protective delete: if any active session is bound to this agent,
    // refuse. Users must complete/close the session (or delete the
    // session) before deleting the agent. This preserves the invariant
    // that a running session always has a valid `agent_definition_id`
    // or NULL — never a dangling UUID pointing at a soft-deleted doc.
    //
    // Note: the underlying FK is `ON DELETE SET NULL`, so a hard-delete
    // would be safe at the DB level. We still block here because the
    // UX promise is "your agent ran that session" — silently falling
    // back to the default agent mid-conversation would be confusing.
    const activeSessions = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.agentDefinitionId, id),
          eq(sessions.status, 'active'),
        ),
      );

    if (activeSessions.length > 0) {
      return error(
        'agent_in_use',
        'Agent has active sessions.',
        409,
        {
          reason: 'agent has active sessions',
          session_ids: activeSessions.map((s) => s.id),
        },
      );
    }

    await db
      .update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(documents.id, id));

    await tryRegenerateManifest(brain.id);

    return success({ id });
  });


// GET /api/brain/documents/[id] — fetch a single document with joined
// owner email + folder name.
// PATCH — partial update. Increments version, writes a document_versions
// snapshot, rejects `isCore` mutations.
// DELETE — Owner only. Soft-delete. Core documents (is_core = true) are
// rejected with 403. Docs referenced by any active agent-definition (via
// the `baseline_docs` or `skills` frontmatter arrays) are rejected with
// 409 + the referencing-agents list so the user can detach them before
// retrying. This mirrors the /api/agents/[id] DELETE guard (which blocks
// agent deletion while an active session references it) — the invariant
// is "no dangling references between live artefacts".

import { and, eq, isNull } from 'drizzle-orm';
import yaml from 'js-yaml';
import { z } from 'zod';

import { db } from '@/db';
import { documents, documentVersions, folders, users } from '@/db/schema';
import { requireRole } from '@/lib/api/auth';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';
import { parseOutboundLinks } from '@/lib/brain-pulse/markdown-links';
import { getBrainForCompany } from '@/lib/brain/queries';
import { validateWorkflowFrontmatter } from '@/lib/brain/frontmatter';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';
import {
  extractDocumentTypeFromContent,
  maybeScheduleSkillManifestRebuild,
} from '@/lib/brain/save';
import {
  getAttachment,
  markCommitted,
} from '@/lib/ingestion/attachments';

type RouteCtx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    content: z.string().optional(),
    summary: z.string().nullable().optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    confidenceLevel: z.enum(['high', 'medium', 'low']).optional(),
    ownerId: z.string().uuid().nullable().optional(),
    folderId: z.string().uuid().optional(),
    // Phase 1.5 Task 8: attachment id forwarded from the proposal-card
    // client-side approve handler. On a successful PATCH we mark the
    // attachment as `committed` against this document. Optional — non-
    // ingestion updates omit this.
    attachmentId: z.string().uuid().optional(),
    // NOTE: `frontmatterPatch` is deliberately NOT in this schema. A
    // previous draft accepted it for forward compatibility with the
    // propose_document_update tool, but the server never applied it —
    // the user saw a "Filed." checkmark while their frontmatter changes
    // were discarded. The `.strict()` call below now rejects any
    // client sending `frontmatterPatch` with a 400 so the UX gap is
    // loud, not silent. Phase 2 will ship real frontmatter-merge
    // handling. See `src/components/chat/proposal-card.tsx::
    // submitUpdate` for the paired client-side guard.
    // isCore is intentionally absent — it is stripped from the body
    // *before* zod parsing (see handler below) so strict mode never
    // rejects a legitimate request carrying the (ignored) flag.
  })
  .strict()
  .refine(
    (v) => {
      // "At least one field required" — ignore attachmentId for the
      // refinement: it's metadata, not a content change. An empty
      // PATCH with only attachmentId would be a no-op update.
      const keys = Object.keys(v).filter((k) => k !== 'attachmentId');
      return keys.length > 0;
    },
    'At least one field required.',
  );

export const GET = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const [row] = await db
      .select({
        id: documents.id,
        companyId: documents.companyId,
        brainId: documents.brainId,
        folderId: documents.folderId,
        folderName: folders.name,
        title: documents.title,
        slug: documents.slug,
        path: documents.path,
        content: documents.content,
        summary: documents.summary,
        status: documents.status,
        ownerId: documents.ownerId,
        ownerEmail: users.email,
        confidenceLevel: documents.confidenceLevel,
        isCore: documents.isCore,
        version: documents.version,
        tokenEstimate: documents.tokenEstimate,
        tags: documents.tags,
        relatedDocuments: documents.relatedDocuments,
        metadata: documents.metadata,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .leftJoin(users, eq(documents.ownerId, users.id))
      .where(
        and(
          eq(documents.id, id),
          eq(documents.brainId, brain.id),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (!row) return error('not_found', 'Document not found.', 404);
    return success(row);
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

    // Explicitly strip isCore if present — it is never user-mutable.
    if (body && typeof body === 'object' && 'isCore' in body) {
      delete (body as Record<string, unknown>).isCore;
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_body', 'Invalid patch.', 400, parsed.error.issues);
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
    if (!existing) return error('not_found', 'Document not found.', 404);

    // Validate attachment id (if provided) against the company. Same
    // contract as POST — mismatch is 400, not a silent skip.
    if (patch.attachmentId) {
      const attachment = await getAttachment(patch.attachmentId, companyId);
      if (!attachment) {
        return error(
          'attachment_not_found',
          'Attachment does not exist or belongs to a different company.',
          400,
        );
      }
    }

    // Recompute path if folder changed.
    let newPath: string | undefined;
    if (patch.folderId && patch.folderId !== existing.folderId) {
      const [folder] = await db
        .select()
        .from(folders)
        .where(and(eq(folders.id, patch.folderId), eq(folders.brainId, brain.id)))
        .limit(1);
      if (!folder) {
        return error('folder_not_found', 'Folder does not belong to your brain.', 400);
      }
      newPath = `${folder.slug}/${existing.slug}`;
    }

    const nextVersion = existing.version + 1;
    const nextContent = patch.content ?? existing.content;

    // Phase 1.5: re-derive the denormalised `type` column from
    // frontmatter whenever content is updated. If the patch leaves
    // content alone, leave the existing `type` alone — no point
    // re-parsing unchanged content.
    const newType =
      patch.content !== undefined
        ? extractDocumentTypeFromContent(patch.content)
        : existing.type;
    const typeUpdate =
      patch.content !== undefined ? { type: newType } : {};

    // Recompute outbound_links when content changes; preserve other metadata fields.
    //
    // Workflow-doc frontmatter sync (Phase 1.5): when the updated content
    // resolves to `type: workflow`, parse the YAML frontmatter from the body
    // and mirror the authored fields (output, output_category, requires_mcps,
    // schedule) into `documents.metadata`. The trigger route's preflight reads
    // these from metadata — without this sync, user edits to requires_mcps in
    // the body are silently invisible at run time.
    //
    // Silent-skip policy: invalid YAML or an invalid workflow-frontmatter
    // shape does not block the save. Users save half-edited YAML mid-thought;
    // we don't want to fight them. The trigger-time preflight +
    // validateWorkflowFrontmatter catches bad shapes at run time.
    //
    // Uses js-yaml (not parseFrontmatterRaw in save.ts) because the hand-rolled
    // parser there doesn't handle YAML arrays like `requires_mcps: [a, b]`.
    let metadataUpdate: { metadata?: unknown } = {};
    if (patch.content !== undefined) {
      const existingMetadata =
        (existing.metadata as Record<string, unknown> | null) ?? {};

      let workflowMetadata: Record<string, unknown> = {};
      if (newType === 'workflow') {
        const fmMatch = patch.content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          try {
            const parsed = yaml.load(fmMatch[1]) as unknown;
            const validated = validateWorkflowFrontmatter(parsed);
            if (validated.ok) {
              workflowMetadata = {
                output: validated.value.output,
                output_category: validated.value.output_category,
                requires_mcps: validated.value.requires_mcps,
                schedule: validated.value.schedule,
              };
            }
            // invalid shape → skip sync, keep existing metadata fields.
          } catch {
            // YAML parse error → skip sync, keep existing metadata fields.
          }
        }
      }

      metadataUpdate = {
        metadata: {
          ...existingMetadata,
          outbound_links: parseOutboundLinks(patch.content),
          ...workflowMetadata,
        },
      };
    }

    const changedKeys = Object.keys(patch);
    const summary = `updated: ${changedKeys.join(', ')}`;

    const [updated] = await db
      .update(documents)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.confidenceLevel !== undefined ? { confidenceLevel: patch.confidenceLevel } : {}),
        ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
        ...(newPath !== undefined ? { path: newPath } : {}),
        ...typeUpdate,
        ...metadataUpdate,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .returning();

    await db.insert(documentVersions).values({
      companyId,
      documentId: id,
      versionNumber: nextVersion,
      content: nextContent,
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
    // Trigger on either side of the change: a doc being re-typed away
    // from `'skill'` must drop out of the manifest, and a doc newly
    // re-typed to `'skill'` must appear in it. Two calls collapse into
    // one rebuild via the loader's per-company debounce.
    maybeScheduleSkillManifestRebuild(companyId, existing.type);
    if (newType !== existing.type) {
      maybeScheduleSkillManifestRebuild(companyId, newType);
    }

    // Mark the originating attachment as committed (fire-and-forget;
    // see POST handler for the rationale).
    if (patch.attachmentId) {
      try {
        await markCommitted(patch.attachmentId, id);
      } catch (err) {
        console.error('[api/brain/documents/[id]] markCommitted failed', err);
      }
    }

    return success(updated);
  });

/**
 * Return the ids + titles of active agent-definition docs whose
 * `baseline_docs` or `skills` frontmatter arrays reference `docId`.
 *
 * Phase 1.5 stores the reference as YAML inside the agent-definition's
 * markdown content (see `buildAgentDefinitionDoc`), so we parse the
 * frontmatter block per row. Returning `{id, title}` (not just id) gives
 * the 409 response a human-readable list the UI can render inline —
 * "Marketing Copywriter, Growth Agent" beats "2 agents reference this".
 *
 * Scoped to the caller's company + non-deleted docs. A small N here
 * (single-digit agent-definition rows per company for MVP) keeps the
 * per-DELETE scan cheap; a denormalised reference table would be the
 * Phase 2 optimisation if this ever grows.
 */
async function findReferencingAgents(
  companyId: string,
  docId: string,
): Promise<Array<{ id: string; title: string }>> {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
    })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        eq(documents.type, 'agent-definition'),
        isNull(documents.deletedAt),
      ),
    );

  const referencing: Array<{ id: string; title: string }> = [];
  for (const row of rows) {
    if (!row.content.startsWith('---\n')) continue;
    const closeIdx = row.content.indexOf('\n---', 4);
    if (closeIdx === -1) continue;
    const block = row.content.slice(4, closeIdx);
    let parsed: unknown;
    try {
      parsed = yaml.load(block);
    } catch {
      // Malformed YAML — skip rather than fail the DELETE. The
      // agent-definition route's own GET / PATCH paths will surface
      // the corruption the next time the user touches this agent.
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const fm = parsed as Record<string, unknown>;
    const baselines = Array.isArray(fm.baseline_docs)
      ? (fm.baseline_docs as unknown[])
      : [];
    const skills = Array.isArray(fm.skills) ? (fm.skills as unknown[]) : [];
    if (baselines.includes(docId) || skills.includes(docId)) {
      referencing.push({ id: row.id, title: row.title });
    }
  }
  return referencing;
}

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
    if (!existing) return error('not_found', 'Document not found.', 404);

    if (existing.isCore) {
      return error('core_document_protected', 'Core documents cannot be deleted.', 403);
    }

    // Protective delete: a doc tagged by any active agent-definition as
    // a baseline doc or a skill cannot be soft-deleted out from under
    // it — the agent's next SessionStart would either degrade silently
    // to scaffolding-only (baseline case) or drop the skill from the
    // candidate pool (skill case), and neither is what the user
    // expects when they hit "delete" on a document. The 409 forces the
    // user to detach the reference first.
    //
    // We SKIP this guard for agent-definition docs themselves — that
    // surface has its own active-session guard on /api/agents/[id];
    // knowledge-docs referencing agent-definitions isn't a valid shape
    // anyway. And we skip for `agent-scaffolding` (there's exactly one
    // per company and nothing references it by id).
    if (existing.type !== 'agent-definition' && existing.type !== 'agent-scaffolding') {
      const referencing = await findReferencingAgents(companyId, id);
      if (referencing.length > 0) {
        return error(
          'document_in_use',
          'Document is referenced by one or more agents.',
          409,
          {
            reason: 'document is referenced by agent-definition(s)',
            agents: referencing,
          },
        );
      }
    }

    await db
      .update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(documents.id, id));

    await tryRegenerateManifest(brain.id);
    // The deleted doc's `type` is the trigger — a skill being
    // soft-deleted must drop out of the manifest.
    maybeScheduleSkillManifestRebuild(companyId, existing.type);

    return success({ id });
  });

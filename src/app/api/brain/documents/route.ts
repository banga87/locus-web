// GET /api/brain/documents — list documents for the caller's brain.
// POST /api/brain/documents — create a new (user-authored, non-core) document.
//
// Auth: Viewer+ on GET, Editor+ on POST. All queries scoped by brainId
// (defence in depth — RLS enforces the same boundary at the DB).
//
// POST side-effects: creates an initial `document_versions` row and fires
// a manifest regeneration (best-effort).

import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import yaml from 'js-yaml';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { documents, documentVersions, folders } from '@/db/schema';
import { requireRole } from '@/lib/api/auth';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { decodeCursor, encodeCursor } from '@/lib/api/pagination';
import { created, error, paginated } from '@/lib/api/response';
import { parseOutboundLinks } from '@/lib/brain-pulse/markdown-links';
import { getBrainForCompany } from '@/lib/brain/queries';
import { validateSkillTrigger } from '@/lib/brain/frontmatter';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';
import { extractDocumentTypeFromContent } from '@/lib/brain/save';
import {
  getAttachment,
  markCommitted,
} from '@/lib/ingestion/attachments';
import { populateCompactIndexForWrite } from '@/lib/write-pipeline/ingest';
import { regenerateFolderOverview } from '@/lib/memory/overview/invalidate';
import { triggerEmbeddingFor } from '@/lib/memory/embedding/trigger';

const SLUG_RE = /^[a-z0-9-]+$/;

const listQuerySchema = z.object({
  folderId: z.string().uuid().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  isCore: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  slug: z.string().regex(SLUG_RE, 'slug must match /^[a-z0-9-]+$/'),
  content: z.string(),
  folderId: z.string().uuid(),
  summary: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  confidenceLevel: z.enum(['high', 'medium', 'low']).optional(),
  // Phase 1.5 Task 8: when the proposal being approved originated
  // from an extracted attachment, the client forwards the attachment
  // id. On a successful create we flip the attachment's status to
  // `committed` and link `committed_doc_id` → new doc. Optional —
  // non-ingestion proposals (agent-authored drafts) omit this field.
  attachmentId: z.string().uuid().optional(),
});

export const GET = (req: Request) =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) {
      return error('invalid_query', 'Invalid query parameters.', 400, parsed.error.issues);
    }
    const q = parsed.data;

    const brain = await getBrainForCompany(companyId);

    // User-document listing: the `type IS NULL` filter keeps
    // scaffolding/skills/agent-definitions out of the main brain view.
    const conds = [
      eq(documents.brainId, brain.id),
      isNull(documents.deletedAt),
      isNull(documents.type),
    ];
    if (q.folderId) conds.push(eq(documents.folderId, q.folderId));
    if (q.status) conds.push(eq(documents.status, q.status));
    if (q.isCore !== undefined) conds.push(eq(documents.isCore, q.isCore === 'true'));

    if (q.cursor) {
      try {
        const cur = decodeCursor<{ updatedAt: string; id: string }>(q.cursor);
        const cursorDate = new Date(cur.updatedAt);
        // (updated_at, id) < (cursorUpdatedAt, cursorId) in desc order
        conds.push(
          or(
            lt(documents.updatedAt, cursorDate),
            and(eq(documents.updatedAt, cursorDate), lt(documents.id, cur.id)),
          )!,
        );
      } catch {
        return error('invalid_cursor', 'Cursor is malformed.', 400);
      }
    }

    const rows = await db
      .select()
      .from(documents)
      .where(and(...conds))
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id })
        : null;

    return paginated(page, nextCursor);
  });

export const POST = (req: Request) =>
  withAuth(async (ctx) => {
    requireRole(ctx, 'editor');
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_json', 'Request body must be JSON.', 400);
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_body', 'Invalid document.', 400, parsed.error.issues);
    }
    const input = parsed.data;

    const brain = await getBrainForCompany(companyId);

    // Folder must belong to the same brain.
    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, input.folderId), eq(folders.brainId, brain.id)))
      .limit(1);
    if (!folder) {
      return error('folder_not_found', 'Folder does not belong to your brain.', 400);
    }

    // Validate the optional attachment id before the transaction —
    // a mismatched tenant is a 400, not a silent skip. Deferring the
    // `markCommitted` call until AFTER the insert succeeds so we
    // never commit an attachment against a doc that failed to create.
    if (input.attachmentId) {
      const attachment = await getAttachment(input.attachmentId, companyId);
      if (!attachment) {
        return error(
          'attachment_not_found',
          'Attachment does not exist or belongs to a different company.',
          400,
        );
      }
    }

    const path = `${folder.slug}/${input.slug}`;

    // Phase 1.5: mirror the frontmatter `type` field into the
    // denormalised column so manifest rebuilds + agent-scaffolding
    // lookups can hit the index instead of parsing content.
    const documentType = extractDocumentTypeFromContent(input.content);

    // Phase 1.5 skill-trigger frontmatter sync: mirrors the PATCH route's
    // logic (see /api/brain/documents/[id]/route.ts). When the new doc is a
    // skill AND its YAML frontmatter carries a nested `trigger:` block, parse
    // it and seed `metadata.trigger` with the authored fields so the trigger
    // route's preflight reads the right values on the very first run —
    // without this, a freshly-created triggerable skill has no
    // `output`/`requires_mcps` in metadata.trigger and every Run click fails
    // validation until the doc is saved at least once.
    //
    // Silent-skip policy: invalid YAML, missing `trigger:` key, or an invalid
    // trigger-block shape does not block creation. Trigger-time validation
    // catches bad shapes at run time.
    //
    // Silent-skip preserves empty triggerPatch on any invalid/missing trigger
    // block. Consequence: a new skill doc with malformed trigger YAML will
    // have no trigger fields in metadata until the next save with a valid
    // block. Trigger-time preflight will fail loudly rather than running with
    // stale or missing values — this is intentional for POST (no existing
    // metadata to preserve) and mirrors the PATCH semantics.
    let triggerPatch: { trigger?: Record<string, unknown> } = {};
    if (documentType === 'skill') {
      // CRLF-safe: \r? handles Windows line endings. Without it, content
      // pasted from a Windows editor silently skips the sync even when the
      // frontmatter block is structurally valid.
      const fmMatch = input.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fmMatch) {
        try {
          const parsed = yaml.load(fmMatch[1]) as unknown;
          if (parsed && typeof parsed === 'object') {
            const fm = parsed as Record<string, unknown>;
            if ('trigger' in fm && fm['trigger'] !== undefined) {
              const validated = validateSkillTrigger(fm['trigger']);
              if (validated.ok) {
                triggerPatch = {
                  trigger: {
                    output: validated.value.output,
                    output_category: validated.value.output_category,
                    requires_mcps: validated.value.requires_mcps,
                    schedule: validated.value.schedule,
                  },
                };
              }
            }
          }
        } catch {
          // YAML parse error — skip sync; trigger-time validation will catch it.
        }
      }
    }

    try {
      const [doc] = await db
        .insert(documents)
        .values({
          companyId,
          brainId: brain.id,
          folderId: input.folderId,
          title: input.title,
          slug: input.slug,
          path,
          content: input.content,
          summary: input.summary ?? null,
          status: input.status ?? 'draft',
          confidenceLevel: input.confidenceLevel ?? 'medium',
          isCore: false,
          ownerId: ctx.userId,
          type: documentType,
          metadata: {
            outbound_links: parseOutboundLinks(input.content),
            ...triggerPatch,
          },
          version: 1,
          compactIndex: populateCompactIndexForWrite({
            content: input.content,
            // Phase 1: parseFrontmatterRaw doesn't support arrays, and
            // entities-as-frontmatter is a Phase 3 feature. Pass empty.
            frontmatterEntities: [],
          }),
        })
        .returning();

      await db.insert(documentVersions).values({
        companyId,
        documentId: doc.id,
        versionNumber: 1,
        content: input.content,
        changeSummary: 'created',
        changedBy: ctx.userId,
        changedByType: 'human',
        metadataSnapshot: {
          title: doc.title,
          status: doc.status,
          confidenceLevel: doc.confidenceLevel,
        },
      });

      await tryRegenerateManifest(brain.id);
      try {
        revalidatePath('/', 'layout');
      } catch {
        // revalidatePath throws outside a Next request context (tests).
        // Safe to skip — next navigation re-queries the layout.
      }

      // Transition the originating attachment (if any) to `committed`.
      // Fire-and-forget: if the update fails, the doc has still been
      // created — the attachment will linger at `extracted` and a
      // future maintenance pass can reconcile. We log but do not fail
      // the request on this step.
      if (input.attachmentId) {
        try {
          await markCommitted(input.attachmentId, doc.id);
        } catch (err) {
          console.error('[api/brain/documents] markCommitted failed', err);
        }
      }

      // Phase 2: enqueue embedding generation. Fire-and-forget; the
      // workflow runs out-of-band and updates documents.embedding when it
      // completes. A failure here shouldn't fail the user's save, so wrap
      // in try/catch with a log.
      try {
        await triggerEmbeddingFor({
          documentId: doc.id,
          companyId,
          brainId: brain.id,
        });
      } catch (err) {
        console.error('[api/brain/documents POST] triggerEmbeddingFor failed', err);
      }

      // Auto-regenerate the folder's overview document so retrieval always
      // has a fresh rollup. Skipped when the saved doc is itself scaffolding,
      // a skill, agent-def, or overview (type != null) — preventing loops.
      if (documentType == null) {
        try {
          await regenerateFolderOverview({
            companyId,
            brainId: brain.id,
            folderPath: folder.slug ?? 'root',
          });
        } catch (err) {
          // Non-fatal: overview regeneration failure should not fail the
          // user's save. Log and move on; next successful save will retry.
          console.error('[api/brain/documents] regenerateFolderOverview POST failed', err);
        }
      }

      return created(doc);
    } catch (e) {
      // Unique slug violation etc.
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return error('slug_conflict', 'A document with that slug already exists.', 409);
      }
      throw e;
    }
  });
